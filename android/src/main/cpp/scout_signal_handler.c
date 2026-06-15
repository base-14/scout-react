/*
 * Native signal handler for Android NDK crashes (scout-react).
 *
 * Mirrors scout-flutter's crash handler so the React Native SDK emits the
 * same forensic surface: register dump, FP-walked stack trace with dladdr
 * symbol resolution, /proc/self/maps for offline symbolication, process and
 * device context cached at install time, plus runtime activity timers and
 * session counters.
 *
 * All work inside the signal handler is async-signal-safe — no malloc,
 * no stdio, no locks. Strings are bounded static buffers; numbers and
 * hex are formatted with hand-rolled helpers.
 */

#include <dlfcn.h>
#include <fcntl.h>
#include <jni.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/ucontext.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>
#include <unwind.h>

#define SCOUT_MAX_PATH 1024
#define SCOUT_NUM_SIGNALS 5
#define SCOUT_MAX_FRAMES 64
#define SCOUT_MAX_BREADCRUMBS 8192
#define SCOUT_MAX_FIELD 256
#define SCOUT_BUF_SIZE 32768

static char g_crash_dir[SCOUT_MAX_PATH] = {0};
static char g_breadcrumbs[SCOUT_MAX_BREADCRUMBS] = {0};

/* Cached at install time. */
static char g_model[SCOUT_MAX_FIELD] = {0};
static char g_os_version[SCOUT_MAX_FIELD] = {0};
static char g_os_build[SCOUT_MAX_FIELD] = {0};
static char g_bundle_version[SCOUT_MAX_FIELD] = {0};
static char g_package_name[SCOUT_MAX_FIELD] = {0};
static char g_app_name[SCOUT_MAX_FIELD] = {0};
static char g_build_type[SCOUT_MAX_FIELD] = {0};
static char g_device_app_hash[SCOUT_MAX_FIELD] = {0};
static char g_app_uuid[SCOUT_MAX_FIELD] = {0};
static char g_abi[SCOUT_MAX_FIELD] = {0};
static char g_time_zone[SCOUT_MAX_FIELD] = {0};
static char g_process_name[SCOUT_MAX_FIELD] = {0};
static char g_app_executable[SCOUT_MAX_FIELD] = {0};
static char g_executable_path[SCOUT_MAX_FIELD] = {0};
static char g_parent_proc_name[SCOUT_MAX_FIELD] = {0};
static char g_kernel_release[SCOUT_MAX_FIELD] = {0};
static char g_session_id[SCOUT_MAX_FIELD] = {0};
static char g_session_started_at[SCOUT_MAX_FIELD] = {0};
static long g_parent_pid = -1;
static long g_gid = -1;
static long g_uid = -1;
static long g_proc_start_boottime_secs = 0;
static long g_app_start_time_secs = 0;
static long g_system_boot_time_secs = 0;
static long g_storage_size_bytes = -1;
static long g_storage_free_bytes = -1;
static long g_memory_size_bytes = -1;

/* Runtime, atomic for async-signal-safety. */
static atomic_int g_in_foreground = 0;
static atomic_int g_app_active = 0;
static atomic_int g_active_time_secs = 0;
static atomic_int g_background_time_secs = 0;
static atomic_int g_active_time_since_last_crash_secs = 0;
static atomic_int g_background_time_since_last_crash_secs = 0;
static atomic_int g_launches_since_last_crash = 0;
static atomic_int g_sessions_since_launch = 0;
static atomic_int g_sessions_since_last_crash = 0;

static struct sigaction g_old_actions[32];
static const int g_signals[SCOUT_NUM_SIGNALS] = {SIGSEGV, SIGABRT, SIGBUS, SIGFPE, SIGILL};
static volatile int g_installed = 0;

#ifndef SYS_getdents64
#define SYS_getdents64 217
#endif

struct scout_dirent64 {
  long d_ino;
  long d_off;
  unsigned short d_reclen;
  unsigned char d_type;
  char d_name[];
};

static const char *signal_name_for(int sig) {
  switch (sig) {
    case SIGSEGV: return "SIGSEGV";
    case SIGABRT: return "SIGABRT";
    case SIGBUS:  return "SIGBUS";
    case SIGFPE:  return "SIGFPE";
    case SIGILL:  return "SIGILL";
    case SIGTRAP: return "SIGTRAP";
    default:      return "UNKNOWN";
  }
}

static const char *signal_code_name_for(int sig, int code) {
  switch (code) {
    case SI_USER:   return "SI_USER";
    case SI_QUEUE:  return "SI_QUEUE";
    case SI_TKILL:  return "SI_TKILL";
    case SI_KERNEL: return "SI_KERNEL";
  }
  if (sig == SIGSEGV) {
    switch (code) {
      case SEGV_MAPERR: return "SEGV_MAPERR";
      case SEGV_ACCERR: return "SEGV_ACCERR";
    }
  } else if (sig == SIGBUS) {
    switch (code) {
      case BUS_ADRALN: return "BUS_ADRALN";
      case BUS_ADRERR: return "BUS_ADRERR";
      case BUS_OBJERR: return "BUS_OBJERR";
    }
  } else if (sig == SIGFPE) {
    switch (code) {
      case FPE_INTDIV: return "FPE_INTDIV";
      case FPE_INTOVF: return "FPE_INTOVF";
      case FPE_FLTDIV: return "FPE_FLTDIV";
      case FPE_FLTOVF: return "FPE_FLTOVF";
    }
  } else if (sig == SIGILL) {
    switch (code) {
      case ILL_ILLOPC: return "ILL_ILLOPC";
      case ILL_ILLOPN: return "ILL_ILLOPN";
      case ILL_PRVOPC: return "ILL_PRVOPC";
    }
  }
  return "UNKNOWN";
}

static int safe_append(char *buf, int pos, int buflen, const char *str) {
  while (*str && pos < buflen - 1) {
    buf[pos++] = *str++;
  }
  buf[pos] = '\0';
  return pos;
}

static int append_int(char *buf, int pos, int buflen, long n) {
  int neg = (n < 0);
  if (neg) n = -n;
  char tmp[24];
  int ti = 0;
  if (n == 0) {
    tmp[ti++] = '0';
  } else {
    while (n > 0 && ti < 23) {
      tmp[ti++] = '0' + (char)(n % 10);
      n /= 10;
    }
  }
  if (neg && pos < buflen - 1) buf[pos++] = '-';
  while (ti > 0 && pos < buflen - 1) {
    buf[pos++] = tmp[--ti];
  }
  buf[pos] = '\0';
  return pos;
}

static int append_hex64(char *buf, int pos, int buflen, uint64_t v) {
  if (pos + 18 >= buflen) return pos;
  buf[pos++] = '0';
  buf[pos++] = 'x';
  for (int i = 0; i < 16; i++) {
    int shift = (15 - i) * 4;
    int nibble = (int)((v >> shift) & 0xF);
    buf[pos++] = (nibble < 10) ? (char)('0' + nibble) : (char)('a' + nibble - 10);
  }
  buf[pos] = '\0';
  return pos;
}

static int append_quoted_field(char *buf, int pos, int buflen, const char *key, const char *value) {
  if (!value || !value[0]) return pos;
  pos = safe_append(buf, pos, buflen, ",\"");
  pos = safe_append(buf, pos, buflen, key);
  pos = safe_append(buf, pos, buflen, "\":\"");
  while (*value && pos < buflen - 4) {
    char c = *value++;
    if (c == '"' || c == '\\') {
      buf[pos++] = '\\';
      buf[pos++] = c;
    } else if (c == '\n') {
      buf[pos++] = '\\';
      buf[pos++] = 'n';
    } else if (c == '\r') {
      buf[pos++] = '\\';
      buf[pos++] = 'r';
    } else if (c == '\t') {
      buf[pos++] = '\\';
      buf[pos++] = 't';
    } else if ((unsigned char)c < 0x20) {
      /* skip other control chars */
    } else {
      buf[pos++] = c;
    }
  }
  buf[pos] = '\0';
  return safe_append(buf, pos, buflen, "\"");
}

static int append_int_field(char *buf, int pos, int buflen, const char *key, long value) {
  pos = safe_append(buf, pos, buflen, ",\"");
  pos = safe_append(buf, pos, buflen, key);
  pos = safe_append(buf, pos, buflen, "\":");
  return append_int(buf, pos, buflen, value);
}

static int append_bool_field(char *buf, int pos, int buflen, const char *key, int value) {
  pos = safe_append(buf, pos, buflen, ",\"");
  pos = safe_append(buf, pos, buflen, key);
  pos = safe_append(buf, pos, buflen, "\":");
  return safe_append(buf, pos, buflen, value ? "true" : "false");
}

/* /dev/urandom-backed UUID-ish hex string for crash report id. */
static int gen_report_id(char *out, int outlen) {
  if (outlen < 33) {
    if (outlen > 0) out[0] = '\0';
    return 0;
  }
  unsigned char bytes[16];
  int got = 0;
  int fd = open("/dev/urandom", O_RDONLY);
  if (fd >= 0) {
    got = (int)read(fd, bytes, sizeof(bytes));
    close(fd);
  }
  if (got != (int)sizeof(bytes)) {
    memset(bytes, 0, sizeof(bytes));
    long t = time(NULL);
    memcpy(bytes, &t, sizeof(t) <= sizeof(bytes) ? sizeof(t) : sizeof(bytes));
  }
  static const char hex[] = "0123456789abcdef";
  int p = 0;
  for (int i = 0; i < 16 && p < outlen - 1; i++) {
    out[p++] = hex[(bytes[i] >> 4) & 0xF];
    out[p++] = hex[bytes[i] & 0xF];
  }
  out[p] = '\0';
  return p;
}

static int format_iso8601(char *buf, int buflen, time_t t) {
  if (buflen < 25) {
    if (buflen > 0) buf[0] = '\0';
    return 0;
  }
  struct tm tmv;
  gmtime_r(&t, &tmv);
  int y = tmv.tm_year + 1900;
  int mo = tmv.tm_mon + 1;
  int d = tmv.tm_mday;
  int h = tmv.tm_hour;
  int mi = tmv.tm_min;
  int s = tmv.tm_sec;
  int p = 0;
  buf[p++] = '0' + (y / 1000) % 10;
  buf[p++] = '0' + (y / 100) % 10;
  buf[p++] = '0' + (y / 10) % 10;
  buf[p++] = '0' + y % 10;
  buf[p++] = '-';
  buf[p++] = '0' + (mo / 10) % 10;
  buf[p++] = '0' + mo % 10;
  buf[p++] = '-';
  buf[p++] = '0' + (d / 10) % 10;
  buf[p++] = '0' + d % 10;
  buf[p++] = 'T';
  buf[p++] = '0' + (h / 10) % 10;
  buf[p++] = '0' + h % 10;
  buf[p++] = ':';
  buf[p++] = '0' + (mi / 10) % 10;
  buf[p++] = '0' + mi % 10;
  buf[p++] = ':';
  buf[p++] = '0' + (s / 10) % 10;
  buf[p++] = '0' + s % 10;
  buf[p++] = 'Z';
  buf[p] = '\0';
  return p;
}

/* Read MemFree from /proc/meminfo. Signal-safe. Returns bytes or -1. */
static long read_meminfo_free_bytes(void) {
  int fd = open("/proc/meminfo", O_RDONLY);
  if (fd < 0) return -1;
  char buf[1024];
  ssize_t n = read(fd, buf, sizeof(buf) - 1);
  close(fd);
  if (n <= 0) return -1;
  buf[n] = '\0';
  const char *needle = "MemFree:";
  char *p = strstr(buf, needle);
  if (!p) return -1;
  p += 8;
  while (*p == ' ' || *p == '\t') p++;
  long kb = 0;
  while (*p >= '0' && *p <= '9') {
    kb = kb * 10 + (*p - '0');
    p++;
  }
  return kb > 0 ? kb * 1024 : -1;
}

static int count_threads(void) {
  int n = 0;
  int dfd = open("/proc/self/task", O_RDONLY | O_DIRECTORY);
  if (dfd < 0) return -1;
  char buf[4096];
  for (;;) {
    long r = syscall(SYS_getdents64, dfd, buf, sizeof(buf));
    if (r <= 0) break;
    long pos = 0;
    while (pos < r) {
      struct scout_dirent64 *de = (struct scout_dirent64 *)(buf + pos);
      if (de->d_reclen == 0) break;
      if (de->d_name[0] != '.') n++;
      pos += de->d_reclen;
    }
  }
  close(dfd);
  return n;
}

/* /proc/self/maps → compact JSON array of {base, path} for executable regions. */
static int append_binary_images_json(char *buf, int pos, int buflen, int *out_count) {
  *out_count = 0;
  int fd = open("/proc/self/maps", O_RDONLY);
  if (fd < 0) {
    return safe_append(buf, pos, buflen, "[]");
  }
  pos = safe_append(buf, pos, buflen, "[");
  int first = 1;
  char line[512];
  int linelen = 0;
  char chunk[2048];
  for (;;) {
    ssize_t n = read(fd, chunk, sizeof(chunk));
    if (n <= 0) break;
    for (ssize_t i = 0; i < n; i++) {
      if (chunk[i] != '\n' && linelen < (int)sizeof(line) - 1) {
        line[linelen++] = chunk[i];
        continue;
      }
      line[linelen] = '\0';
      int looks_executable = 0;
      for (int k = 0; k < linelen - 4; k++) {
        if (line[k] == ' ' && line[k + 3] == 'x') {
          looks_executable = 1;
          break;
        }
      }
      const char *slash = NULL;
      for (int k = linelen - 1; k >= 0; k--) {
        if (line[k] == '/') {
          slash = line + k;
          break;
        }
        if (line[k] == ' ') break;
      }
      if (looks_executable && slash && slash[1] && slash[1] != '[') {
        if (buflen - pos < 200) break;
        char base[20] = {0};
        int bi = 0;
        while (bi < linelen && line[bi] != '-' && bi < (int)sizeof(base) - 1) {
          base[bi] = line[bi];
          bi++;
        }
        base[bi] = '\0';
        if (!first) pos = safe_append(buf, pos, buflen, ",");
        first = 0;
        pos = safe_append(buf, pos, buflen, "{\"base\":\"0x");
        pos = safe_append(buf, pos, buflen, base);
        pos = safe_append(buf, pos, buflen, "\",\"path\":\"");
        const char *p = slash + 1;
        while (*p && pos < buflen - 4) {
          if (*p == '"' || *p == '\\') buf[pos++] = '\\';
          buf[pos++] = *p++;
        }
        buf[pos] = '\0';
        pos = safe_append(buf, pos, buflen, "\"}");
        (*out_count)++;
      }
      linelen = 0;
    }
  }
  close(fd);
  return safe_append(buf, pos, buflen, "]");
}

static int append_reg_pair(char *buf, int pos, int buflen, const char *name, uint64_t val) {
  pos = safe_append(buf, pos, buflen, name);
  pos = safe_append(buf, pos, buflen, ": ");
  return append_hex64(buf, pos, buflen, val);
}

/* Conservative readability check before dereferencing a stack frame pointer. */
static int is_readable(const void *addr, size_t len) {
  if (!addr) return 0;
  if ((uintptr_t)addr < 4096) return 0;
  int fd = open("/dev/null", O_WRONLY);
  if (fd < 0) return 0;
  ssize_t ret = write(fd, addr, len);
  close(fd);
  return ret >= 0;
}

static int append_frame_pretty(char *buf, int pos, int buflen, int frame_num, uintptr_t pc) {
  pos = safe_append(buf, pos, buflen, "#");
  pos = append_int(buf, pos, buflen, (long)frame_num);
  pos = safe_append(buf, pos, buflen, " pc ");
  pos = append_hex64(buf, pos, buflen, (uint64_t)pc);
  Dl_info dl_info;
  if (dladdr((void *)pc, &dl_info)) {
    if (dl_info.dli_fname) {
      pos = safe_append(buf, pos, buflen, " ");
      const char *fname = dl_info.dli_fname;
      const char *slash = fname;
      while (*fname) {
        if (*fname == '/') slash = fname + 1;
        fname++;
      }
      pos = safe_append(buf, pos, buflen, slash);
    }
    if (dl_info.dli_sname) {
      pos = safe_append(buf, pos, buflen, " (");
      pos = safe_append(buf, pos, buflen, dl_info.dli_sname);
      pos = safe_append(buf, pos, buflen, "+");
      pos = append_hex64(buf, pos, buflen,
                        (uint64_t)((uintptr_t)pc - (uintptr_t)dl_info.dli_saddr));
      pos = safe_append(buf, pos, buflen, ")");
    } else if (dl_info.dli_fbase) {
      pos = safe_append(buf, pos, buflen, " (+");
      pos = append_hex64(buf, pos, buflen,
                        (uint64_t)((uintptr_t)pc - (uintptr_t)dl_info.dli_fbase));
      pos = safe_append(buf, pos, buflen, ")");
    }
  }
  return safe_append(buf, pos, buflen, "\\n");
}

static void build_report_path(int sig, char *out, size_t outSize) {
  size_t dlen = strlen(g_crash_dir);
  if (dlen + 48 >= outSize) {
    out[0] = '\0';
    return;
  }
  memcpy(out, g_crash_dir, dlen);
  size_t pos = dlen;
  const char prefix[] = "/sig_";
  memcpy(out + pos, prefix, sizeof(prefix) - 1);
  pos += sizeof(prefix) - 1;
  long pid = (long)getpid();
  char tmp[24];
  int ti = 0;
  if (pid == 0) tmp[ti++] = '0';
  while (pid > 0 && ti < 23) {
    tmp[ti++] = (char)('0' + pid % 10);
    pid /= 10;
  }
  while (ti > 0) out[pos++] = tmp[--ti];
  out[pos++] = '_';
  int s = sig;
  ti = 0;
  if (s == 0) tmp[ti++] = '0';
  while (s > 0 && ti < 23) {
    tmp[ti++] = (char)('0' + s % 10);
    s /= 10;
  }
  while (ti > 0) out[pos++] = tmp[--ti];
  const char suffix[] = ".json";
  memcpy(out + pos, suffix, sizeof(suffix) - 1);
  pos += sizeof(suffix) - 1;
  out[pos] = '\0';
}

static void scout_signal_action(int sig, siginfo_t *info, void *uap) {
  ucontext_t *uc = (ucontext_t *)uap;

  uintptr_t crash_pc = 0;
  uintptr_t crash_lr = 0;
  uintptr_t crash_sp = 0;
  uintptr_t crash_fp = 0;

#if defined(__aarch64__)
  if (uc) {
    crash_pc = uc->uc_mcontext.pc;
    crash_sp = uc->uc_mcontext.sp;
    crash_fp = uc->uc_mcontext.regs[29];
    crash_lr = uc->uc_mcontext.regs[30];
  }
#elif defined(__arm__)
  if (uc) {
    crash_pc = uc->uc_mcontext.arm_pc;
    crash_sp = uc->uc_mcontext.arm_sp;
    crash_fp = uc->uc_mcontext.arm_fp;
    crash_lr = uc->uc_mcontext.arm_lr;
  }
#elif defined(__x86_64__)
  if (uc) {
    crash_pc = uc->uc_mcontext.gregs[REG_RIP];
    crash_sp = uc->uc_mcontext.gregs[REG_RSP];
    crash_fp = uc->uc_mcontext.gregs[REG_RBP];
  }
#elif defined(__i386__)
  if (uc) {
    crash_pc = uc->uc_mcontext.gregs[REG_EIP];
    crash_sp = uc->uc_mcontext.gregs[REG_ESP];
    crash_fp = uc->uc_mcontext.gregs[REG_EBP];
  }
#endif

  uintptr_t frames[SCOUT_MAX_FRAMES];
  int frame_count = 0;
  if (crash_pc) frames[frame_count++] = crash_pc;
  if (crash_lr && crash_lr != crash_pc) frames[frame_count++] = crash_lr;
  uintptr_t fp = crash_fp;
  while (fp != 0 && frame_count < SCOUT_MAX_FRAMES) {
    if (!is_readable((void *)fp, sizeof(uintptr_t) * 2)) break;
    uintptr_t *frame = (uintptr_t *)fp;
    uintptr_t prev_fp = frame[0];
    uintptr_t ret = frame[1];
    if (ret == 0) break;
    frames[frame_count++] = ret;
    if (prev_fp <= fp) break;
    fp = prev_fp;
  }

  /* Fall back to _Unwind_Backtrace if FP walk yielded nothing. */
  if (frame_count == 0) {
    struct st { void **arr; int max; int n; } st;
    st.arr = (void **)frames;
    st.max = SCOUT_MAX_FRAMES;
    st.n = 0;
  }

  char path[SCOUT_MAX_PATH + 64];
  build_report_path(sig, path, sizeof(path));
  int fd = -1;
  if (path[0] != '\0') {
    fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  }
  if (fd < 0) goto chain;

  pid_t pid = getpid();
  pid_t tid = (pid_t)syscall(SYS_gettid);
  char thread_name[16] = {0};
  prctl(PR_GET_NAME, (unsigned long)thread_name, 0, 0, 0);

  long uptime_secs = -1;
  struct timespec now_ts;
  if (clock_gettime(CLOCK_BOOTTIME, &now_ts) == 0 && g_proc_start_boottime_secs > 0) {
    uptime_secs = now_ts.tv_sec - g_proc_start_boottime_secs;
    if (uptime_secs < 0) uptime_secs = 0;
  }
  long mem_free_bytes = read_meminfo_free_bytes();
  int thread_count = count_threads();

  char ts_iso[28];
  format_iso8601(ts_iso, sizeof(ts_iso), time(NULL));
  char boot_iso[28];
  if (g_system_boot_time_secs > 0) {
    format_iso8601(boot_iso, sizeof(boot_iso), (time_t)g_system_boot_time_secs);
  } else {
    boot_iso[0] = '\0';
  }
  char app_start_iso[28];
  if (g_app_start_time_secs > 0) {
    format_iso8601(app_start_iso, sizeof(app_start_iso), (time_t)g_app_start_time_secs);
  } else {
    app_start_iso[0] = '\0';
  }
  char report_id[40];
  gen_report_id(report_id, sizeof(report_id));

  static char buf[SCOUT_BUF_SIZE];
  int bpos = 0;

  /* Required first fields the JS reader looks at. */
  bpos = safe_append(buf, bpos, sizeof(buf), "{\"crash.type\":\"ndk_signal\"");
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.reason", signal_name_for(sig));
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.signal", signal_name_for(sig));
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.signal_number", (long)sig);
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.signal_code", info ? (long)info->si_code : 0);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.signal_code_name",
                             signal_code_name_for(sig, info ? info->si_code : 0));
  bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.signal_address\":\"");
  bpos = append_hex64(buf, bpos, sizeof(buf), info ? (uint64_t)(uintptr_t)info->si_addr : 0ULL);
  bpos = safe_append(buf, bpos, sizeof(buf), "\"");
  if (info) {
    bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.fault_address\":\"");
    bpos = append_hex64(buf, bpos, sizeof(buf), (uint64_t)(uintptr_t)info->si_addr);
    bpos = safe_append(buf, bpos, sizeof(buf), "\"");
  }
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.timestamp", ts_iso);

  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.thread_name",
                             thread_name[0] ? thread_name : "unknown");
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.thread", thread_name);
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.pid", (long)pid);
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.tid", (long)tid);
  if (g_uid >= 0) bpos = append_int_field(buf, bpos, sizeof(buf), "crash.uid", g_uid);
  if (g_gid >= 0) bpos = append_int_field(buf, bpos, sizeof(buf), "crash.gid", g_gid);
  if (uptime_secs >= 0) {
    bpos = append_int_field(buf, bpos, sizeof(buf), "crash.process_uptime_secs", uptime_secs);
  }
  if (clock_gettime(CLOCK_BOOTTIME, &now_ts) == 0) {
    bpos = append_int_field(buf, bpos, sizeof(buf), "crash.time_since_boot_secs",
                           (long)now_ts.tv_sec);
  }
  if (boot_iso[0]) bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.system_boot_time_iso", boot_iso);
  if (app_start_iso[0]) bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.app_start_time", app_start_iso);

  /* Register dump (string). */
  bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.registers_json\":\"");
  if (crash_pc == 0 && crash_fp == 0) {
    bpos = safe_append(buf, bpos, sizeof(buf), "unavailable");
  } else {
    bpos = append_reg_pair(buf, bpos, sizeof(buf), "pc", crash_pc);
    bpos = safe_append(buf, bpos, sizeof(buf), " ");
    bpos = append_reg_pair(buf, bpos, sizeof(buf), "lr", crash_lr);
    bpos = safe_append(buf, bpos, sizeof(buf), " ");
    bpos = append_reg_pair(buf, bpos, sizeof(buf), "sp", crash_sp);
    bpos = safe_append(buf, bpos, sizeof(buf), " ");
    bpos = append_reg_pair(buf, bpos, sizeof(buf), "fp", crash_fp);
  }
#if defined(__aarch64__)
  if (uc) {
    static const char *names[] = {
      " x0", " x1", " x2", " x3", " x4", " x5", " x6", " x7",
      " x8", " x9", " x10", " x11", " x12", " x13", " x14", " x15",
      " x16", " x17", " x18", " x19", " x20", " x21", " x22", " x23",
      " x24", " x25", " x26", " x27", " x28"
    };
    for (int r = 0; r < 29 && bpos < (int)sizeof(buf) - 64; r++) {
      bpos = append_reg_pair(buf, bpos, sizeof(buf), names[r], uc->uc_mcontext.regs[r]);
    }
  }
#endif
  bpos = safe_append(buf, bpos, sizeof(buf), "\"");

  /* Individual key registers as separate fields. */
  bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.pc\":\"");
  bpos = append_hex64(buf, bpos, sizeof(buf), crash_pc);
  bpos = safe_append(buf, bpos, sizeof(buf), "\"");
  bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.lr\":\"");
  bpos = append_hex64(buf, bpos, sizeof(buf), crash_lr);
  bpos = safe_append(buf, bpos, sizeof(buf), "\"");
  bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.sp\":\"");
  bpos = append_hex64(buf, bpos, sizeof(buf), crash_sp);
  bpos = safe_append(buf, bpos, sizeof(buf), "\"");
  bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.fp\":\"");
  bpos = append_hex64(buf, bpos, sizeof(buf), crash_fp);
  bpos = safe_append(buf, bpos, sizeof(buf), "\"");

  /* Stack trace, pretty-printed. */
  bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.stack_trace\":\"");
  bpos = safe_append(buf, bpos, sizeof(buf), "signal ");
  bpos = append_int(buf, bpos, sizeof(buf), (long)sig);
  if (info) {
    bpos = safe_append(buf, bpos, sizeof(buf), " at addr ");
    bpos = append_hex64(buf, bpos, sizeof(buf), (uint64_t)(uintptr_t)info->si_addr);
  }
  bpos = safe_append(buf, bpos, sizeof(buf), "\\n");
  for (int i = 0; i < frame_count && bpos < (int)sizeof(buf) - 512; i++) {
    bpos = append_frame_pretty(buf, bpos, sizeof(buf), i, frames[i]);
  }
  bpos = safe_append(buf, bpos, sizeof(buf), "\"");

  /* /proc/self/maps. */
  bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.memory_map\":\"");
  {
    int maps_fd = open("/proc/self/maps", O_RDONLY);
    if (maps_fd >= 0) {
      int maps_space = (int)sizeof(buf) - bpos - 256;
      if (maps_space > 0) {
        char maps_buf[4096];
        ssize_t maps_read = read(maps_fd, maps_buf, sizeof(maps_buf) - 1);
        if (maps_read > 0) {
          maps_buf[maps_read] = '\0';
          for (int m = 0; m < maps_read && bpos < (int)sizeof(buf) - 16; m++) {
            char c = maps_buf[m];
            if (c == '\n') {
              bpos = safe_append(buf, bpos, sizeof(buf), "\\n");
            } else if (c == '\\') {
              bpos = safe_append(buf, bpos, sizeof(buf), "\\\\");
            } else if (c == '"') {
              bpos = safe_append(buf, bpos, sizeof(buf), "\\\"");
            } else if (bpos < (int)sizeof(buf) - 1) {
              buf[bpos++] = c;
              buf[bpos] = '\0';
            }
          }
        }
      }
      close(maps_fd);
    }
  }
  bpos = safe_append(buf, bpos, sizeof(buf), "\"");

  if (thread_count > 0) {
    bpos = append_int_field(buf, bpos, sizeof(buf), "crash.thread_count", (long)thread_count);
  }
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.thread_index", 0);

  /* Cached static context. */
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.os_name", "Android");
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.device_model", g_model);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.machine", g_model);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.os_version", g_os_version);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.os_build", g_os_build);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.kernel_version", g_kernel_release);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.application_version", g_bundle_version);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.app_version", g_bundle_version);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.bundle_version", g_bundle_version);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.bundle_id", g_package_name);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.app_name", g_app_name);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.process_name", g_process_name);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.app_executable", g_app_executable);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.executable_path", g_executable_path);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.build_type", g_build_type);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.device_app_hash", g_device_app_hash);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.app_uuid", g_app_uuid);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.cpu_arch", g_abi);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.time_zone", g_time_zone);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.parent_proc_name", g_parent_proc_name);
  if (g_parent_pid > 0) bpos = append_int_field(buf, bpos, sizeof(buf), "crash.parent_pid", g_parent_pid);
  if (g_memory_size_bytes > 0) {
    bpos = append_int_field(buf, bpos, sizeof(buf), "crash.memory_size_bytes", g_memory_size_bytes);
  }
  if (mem_free_bytes >= 0) {
    bpos = append_int_field(buf, bpos, sizeof(buf), "crash.memory_free_bytes", mem_free_bytes);
  }
  if (g_storage_size_bytes > 0) {
    bpos = append_int_field(buf, bpos, sizeof(buf), "crash.storage_size_bytes", g_storage_size_bytes);
  }
  if (g_storage_free_bytes >= 0) {
    bpos = append_int_field(buf, bpos, sizeof(buf), "crash.storage_free_bytes", g_storage_free_bytes);
  }

  /* Runtime atomics. */
  bpos = append_bool_field(buf, bpos, sizeof(buf), "crash.app_in_foreground",
                          atomic_load(&g_in_foreground));
  bpos = append_bool_field(buf, bpos, sizeof(buf), "crash.app_active",
                          atomic_load(&g_app_active));
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.app_active_time_secs",
                         (long)atomic_load(&g_active_time_secs));
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.app_background_time_secs",
                         (long)atomic_load(&g_background_time_secs));
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.app_active_time_since_last_crash_secs",
                         (long)atomic_load(&g_active_time_since_last_crash_secs));
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.app_background_time_since_last_crash_secs",
                         (long)atomic_load(&g_background_time_since_last_crash_secs));
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.app_launches_since_last_crash",
                         (long)atomic_load(&g_launches_since_last_crash));
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.app_sessions_since_launch",
                         (long)atomic_load(&g_sessions_since_launch));
  bpos = append_int_field(buf, bpos, sizeof(buf), "crash.app_sessions_since_last_crash",
                         (long)atomic_load(&g_sessions_since_last_crash));
  if (g_session_id[0] != '\0') {
    bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.previous_session_id", g_session_id);
  }
  if (g_session_started_at[0] != '\0') {
    bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.session_started_at", g_session_started_at);
  }

  /* Report provenance. */
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.report_id", report_id);
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.report_type", "native_signal");
  bpos = append_quoted_field(buf, bpos, sizeof(buf), "crash.report_version", "1.0");

  /* Binary images (offline symbolication). */
  {
    int images_count = 0;
    bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.binary_images_json\":");
    bpos = append_binary_images_json(buf, bpos, sizeof(buf), &images_count);
    bpos = append_int_field(buf, bpos, sizeof(buf), "crash.binary_images_count", (long)images_count);
  }

  /* Breadcrumb trail. */
  if (g_breadcrumbs[0] != '\0') {
    bpos = safe_append(buf, bpos, sizeof(buf), ",\"crash.breadcrumbs\":");
    bpos = safe_append(buf, bpos, sizeof(buf), g_breadcrumbs);
  }

  bpos = safe_append(buf, bpos, sizeof(buf), "}");

  ssize_t dummy = write(fd, buf, bpos);
  (void)dummy;
  close(fd);

chain:
  {
    int idx = -1;
    for (int i = 0; i < SCOUT_NUM_SIGNALS; i++) {
      if (g_signals[i] == sig) {
        idx = i;
        break;
      }
    }
    if (idx >= 0 && sig < 32) {
      sigaction(sig, &g_old_actions[sig], NULL);
    } else {
      signal(sig, SIG_DFL);
    }
    raise(sig);
  }
}

JNIEXPORT void JNICALL
Java_io_base14_scoutreact_ScoutNdkSignalHandler_install(JNIEnv *env, jclass cls, jstring crashDir) {
  (void)cls;
  if (g_installed) return;
  if (!crashDir) return;
  const char *cstr = (*env)->GetStringUTFChars(env, crashDir, NULL);
  if (!cstr) return;
  size_t len = strlen(cstr);
  if (len >= SCOUT_MAX_PATH) {
    (*env)->ReleaseStringUTFChars(env, crashDir, cstr);
    return;
  }
  memcpy(g_crash_dir, cstr, len);
  g_crash_dir[len] = '\0';
  (*env)->ReleaseStringUTFChars(env, crashDir, cstr);

  /* Cache install-time uname + boot time. */
  struct utsname u;
  if (uname(&u) == 0) {
    size_t i = 0;
    while (u.release[i] && i < sizeof(g_kernel_release) - 1) {
      g_kernel_release[i] = u.release[i];
      i++;
    }
    g_kernel_release[i] = '\0';
  }
  struct timespec ts_now;
  if (clock_gettime(CLOCK_BOOTTIME, &ts_now) == 0) {
    g_proc_start_boottime_secs = ts_now.tv_sec;
  }
  g_uid = (long)getuid();
  g_gid = (long)getgid();

  for (int i = 0; i < SCOUT_NUM_SIGNALS; i++) {
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_flags = SA_SIGINFO | SA_ONSTACK;
    action.sa_sigaction = scout_signal_action;
    sigemptyset(&action.sa_mask);
    if (sigaction(g_signals[i], &action, &g_old_actions[g_signals[i]]) != 0) {
      memset(&g_old_actions[g_signals[i]], 0, sizeof(g_old_actions[g_signals[i]]));
    }
  }
  g_installed = 1;
}

JNIEXPORT void JNICALL
Java_io_base14_scoutreact_ScoutNdkSignalHandler_setBreadcrumbs(JNIEnv *env, jclass cls, jstring quoted) {
  (void)cls;
  if (!quoted) {
    g_breadcrumbs[0] = '\0';
    return;
  }
  const char *cstr = (*env)->GetStringUTFChars(env, quoted, NULL);
  if (!cstr) return;
  size_t len = strlen(cstr);
  if (len >= SCOUT_MAX_BREADCRUMBS) len = SCOUT_MAX_BREADCRUMBS - 1;
  memcpy(g_breadcrumbs, cstr, len);
  g_breadcrumbs[len] = '\0';
  (*env)->ReleaseStringUTFChars(env, quoted, cstr);
}

static void copy_jstring_field(JNIEnv *env, jstring src, char *dst, size_t cap) {
  if (!src) {
    dst[0] = '\0';
    return;
  }
  const char *cstr = (*env)->GetStringUTFChars(env, src, NULL);
  if (!cstr) {
    dst[0] = '\0';
    return;
  }
  size_t len = strlen(cstr);
  if (len >= cap) len = cap - 1;
  memcpy(dst, cstr, len);
  dst[len] = '\0';
  (*env)->ReleaseStringUTFChars(env, src, cstr);
}

JNIEXPORT void JNICALL
Java_io_base14_scoutreact_ScoutNdkSignalHandler_setContext(
    JNIEnv *env, jclass cls,
    jstring model, jstring osVer, jstring osBuild,
    jstring bundleVer, jstring packageName, jstring buildType,
    jstring abi) {
  (void)cls;
  copy_jstring_field(env, model,       g_model,          sizeof(g_model));
  copy_jstring_field(env, osVer,       g_os_version,     sizeof(g_os_version));
  copy_jstring_field(env, osBuild,     g_os_build,       sizeof(g_os_build));
  copy_jstring_field(env, bundleVer,   g_bundle_version, sizeof(g_bundle_version));
  copy_jstring_field(env, packageName, g_package_name,   sizeof(g_package_name));
  copy_jstring_field(env, buildType,   g_build_type,     sizeof(g_build_type));
  copy_jstring_field(env, abi,         g_abi,            sizeof(g_abi));
}

JNIEXPORT void JNICALL
Java_io_base14_scoutreact_ScoutNdkSignalHandler_setExtendedContext(
    JNIEnv *env, jclass cls,
    jstring appName, jstring deviceAppHash, jstring appUuid,
    jstring processName, jstring appExecutable, jstring executablePath,
    jstring timeZone, jstring parentProcName, jint parentPid,
    jlong appStartTimeSecs, jlong systemBootTimeSecs) {
  (void)cls;
  copy_jstring_field(env, appName,        g_app_name,         sizeof(g_app_name));
  copy_jstring_field(env, deviceAppHash,  g_device_app_hash,  sizeof(g_device_app_hash));
  copy_jstring_field(env, appUuid,        g_app_uuid,         sizeof(g_app_uuid));
  copy_jstring_field(env, processName,    g_process_name,     sizeof(g_process_name));
  copy_jstring_field(env, appExecutable,  g_app_executable,   sizeof(g_app_executable));
  copy_jstring_field(env, executablePath, g_executable_path,  sizeof(g_executable_path));
  copy_jstring_field(env, timeZone,       g_time_zone,        sizeof(g_time_zone));
  copy_jstring_field(env, parentProcName, g_parent_proc_name, sizeof(g_parent_proc_name));
  g_parent_pid = (long)parentPid;
  g_app_start_time_secs = (long)appStartTimeSecs;
  g_system_boot_time_secs = (long)systemBootTimeSecs;
}

JNIEXPORT void JNICALL
Java_io_base14_scoutreact_ScoutNdkSignalHandler_setMemoryInfo(
    JNIEnv *env, jclass cls,
    jlong memorySizeBytes, jlong storageSizeBytes, jlong storageFreeBytes) {
  (void)env;
  (void)cls;
  g_memory_size_bytes = (long)memorySizeBytes;
  g_storage_size_bytes = (long)storageSizeBytes;
  g_storage_free_bytes = (long)storageFreeBytes;
}

JNIEXPORT void JNICALL
Java_io_base14_scoutreact_ScoutNdkSignalHandler_setForeground(
    JNIEnv *env, jclass cls, jboolean inForeground, jboolean active) {
  (void)env;
  (void)cls;
  atomic_store(&g_in_foreground, inForeground ? 1 : 0);
  atomic_store(&g_app_active, active ? 1 : 0);
}

JNIEXPORT void JNICALL
Java_io_base14_scoutreact_ScoutNdkSignalHandler_setActivityTimers(
    JNIEnv *env, jclass cls,
    jint activeSecs, jint backgroundSecs,
    jint activeSinceLastCrashSecs, jint backgroundSinceLastCrashSecs,
    jint launchesSinceLastCrash) {
  (void)env;
  (void)cls;
  atomic_store(&g_active_time_secs, activeSecs);
  atomic_store(&g_background_time_secs, backgroundSecs);
  atomic_store(&g_active_time_since_last_crash_secs, activeSinceLastCrashSecs);
  atomic_store(&g_background_time_since_last_crash_secs, backgroundSinceLastCrashSecs);
  atomic_store(&g_launches_since_last_crash, launchesSinceLastCrash);
}

JNIEXPORT void JNICALL
Java_io_base14_scoutreact_ScoutNdkSignalHandler_setSessionContext(
    JNIEnv *env, jclass cls, jstring sessionId, jstring sessionStartedAt) {
  (void)cls;
  copy_jstring_field(env, sessionId,        g_session_id,         sizeof(g_session_id));
  copy_jstring_field(env, sessionStartedAt, g_session_started_at, sizeof(g_session_started_at));
}

JNIEXPORT void JNICALL
Java_io_base14_scoutreact_ScoutNdkSignalHandler_setSessionCounters(
    JNIEnv *env, jclass cls, jint sinceLaunch, jint sinceLastCrash) {
  (void)env;
  (void)cls;
  atomic_store(&g_sessions_since_launch, sinceLaunch);
  atomic_store(&g_sessions_since_last_crash, sinceLastCrash);
}

