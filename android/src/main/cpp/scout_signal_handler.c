

#include <fcntl.h>
#include <jni.h>
#include <signal.h>
#include <stdint.h>
#include <string.h>
#include <sys/time.h>
#include <sys/types.h>
#include <unistd.h>
#include <unwind.h>

#define SCOUT_MAX_PATH 1024
#define SCOUT_NUM_SIGNALS 6
#define SCOUT_MAX_FRAMES 64

static char g_crash_dir[SCOUT_MAX_PATH] = {0};
static struct sigaction g_old_actions[SCOUT_NUM_SIGNALS];
static const int g_signals[SCOUT_NUM_SIGNALS] = {
    SIGSEGV, SIGABRT, SIGBUS, SIGILL, SIGFPE, SIGTRAP};
static const char *const g_signal_names[SCOUT_NUM_SIGNALS] = {
    "SIGSEGV", "SIGABRT", "SIGBUS", "SIGILL", "SIGFPE", "SIGTRAP"};
static volatile int g_installed = 0;

static void write_all(int fd, const char *buf, size_t len) {
  while (len > 0) {
    ssize_t w = write(fd, buf, len);
    if (w < 0) return;
    if ((size_t)w >= len) return;
    buf += w; len -= (size_t)w;
  }
}

static void write_cstr(int fd, const char *s) {
  size_t n = 0;
  while (s[n]) n++;
  write_all(fd, s, n);
}

static void write_int_dec(int fd, long n) {
  char buf[32];
  int neg = (n < 0);
  if (neg) n = -n;
  int i = 0;
  if (n == 0) {
    buf[i++] = '0';
  } else {
    while (n > 0 && i < 30) {
      buf[i++] = '0' + (char)(n % 10);
      n /= 10;
    }
  }
  if (neg) buf[i++] = '-';
  for (int j = 0; j < i / 2; j++) {
    char t = buf[j]; buf[j] = buf[i - 1 - j]; buf[i - 1 - j] = t;
  }
  write_all(fd, buf, (size_t)i);
}

static void write_hex64(int fd, uint64_t v) {
  char buf[18];
  buf[0] = '0'; buf[1] = 'x';
  for (int i = 0; i < 16; i++) {
    int shift = (15 - i) * 4;
    int nibble = (int)((v >> shift) & 0xF);
    buf[2 + i] = (nibble < 10) ? (char)('0' + nibble) : (char)('a' + nibble - 10);
  }
  write_all(fd, buf, sizeof(buf));
}

static const char *signal_name_for(int sig) {
  for (int i = 0; i < SCOUT_NUM_SIGNALS; i++) {
    if (g_signals[i] == sig) return g_signal_names[i];
  }
  return "UNKNOWN";
}

static int old_action_index_for(int sig) {
  for (int i = 0; i < SCOUT_NUM_SIGNALS; i++) {
    if (g_signals[i] == sig) return i;
  }
  return -1;
}

struct unwind_state {
  void **frames;
  int max;
  int count;
};

static _Unwind_Reason_Code unwind_cb(struct _Unwind_Context *ctx, void *arg) {
  struct unwind_state *st = (struct unwind_state *)arg;
  if (st->count >= st->max) return _URC_END_OF_STACK;
  uintptr_t pc = _Unwind_GetIP(ctx);
  if (pc) st->frames[st->count++] = (void *)pc;
  return _URC_NO_REASON;
}

static void build_report_path(int sig, char *out, size_t outSize) {
  size_t dlen = strlen(g_crash_dir);
  if (dlen + 40 >= outSize) {
    out[0] = 0;
    return;
  }
  memcpy(out, g_crash_dir, dlen);
  size_t pos = dlen;
  const char prefix[] = "/sig_";
  memcpy(out + pos, prefix, sizeof(prefix) - 1);
  pos += sizeof(prefix) - 1;
  long pid = (long)getpid();
  char tmp[16]; int ti = 0;
  if (pid == 0) tmp[ti++] = '0';
  while (pid > 0 && ti < 15) { tmp[ti++] = '0' + (char)(pid % 10); pid /= 10; }
  while (ti > 0) out[pos++] = tmp[--ti];
  out[pos++] = '_';
  int s = sig;
  ti = 0;
  if (s == 0) tmp[ti++] = '0';
  while (s > 0 && ti < 15) { tmp[ti++] = '0' + (char)(s % 10); s /= 10; }
  while (ti > 0) out[pos++] = tmp[--ti];
  const char suffix[] = ".json";
  memcpy(out + pos, suffix, sizeof(suffix) - 1);
  pos += sizeof(suffix) - 1;
  out[pos] = 0;
}

static void scout_signal_action(int sig, siginfo_t *info, void *uap) {
  (void)uap;

  char path[SCOUT_MAX_PATH + 64];
  build_report_path(sig, path, sizeof(path));
  int fd = -1;
  if (path[0] != 0) {
    fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  }
  if (fd < 0) goto chain;

  write_cstr(fd, "{\"crash.type\":\"ndk_signal\",\"crash.signal\":\"");
  write_cstr(fd, signal_name_for(sig));
  write_cstr(fd, "\",\"crash.signal_code\":");
  write_int_dec(fd, info ? (long)info->si_code : 0L);
  write_cstr(fd, ",\"crash.signal_address\":\"");
  write_hex64(fd, info ? (uint64_t)(uintptr_t)info->si_addr : 0ULL);
  write_cstr(fd, "\",\"crash.thread\":\"unknown\",\"crash.timestamp\":\"");
  struct timeval tv;
  if (gettimeofday(&tv, NULL) == 0) {
    write_int_dec(fd, (long)tv.tv_sec);
  } else {
    write_cstr(fd, "0");
  }
  write_cstr(fd, "\",\"crash.stack_trace\":\"");
  void *frames[SCOUT_MAX_FRAMES];
  struct unwind_state st = { frames, SCOUT_MAX_FRAMES, 0 };
  _Unwind_Backtrace(unwind_cb, &st);
  for (int i = 0; i < st.count; i++) {
    if (i > 0) write_cstr(fd, "\\n");
    write_hex64(fd, (uint64_t)(uintptr_t)frames[i]);
  }
  write_cstr(fd, "\"}");
  close(fd);

chain:
  {
    int idx = old_action_index_for(sig);
    if (idx >= 0) {
      sigaction(sig, &g_old_actions[idx], NULL);
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
  g_crash_dir[len] = 0;
  (*env)->ReleaseStringUTFChars(env, crashDir, cstr);

  for (int i = 0; i < SCOUT_NUM_SIGNALS; i++) {
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_flags = SA_SIGINFO;
    action.sa_sigaction = scout_signal_action;
    sigemptyset(&action.sa_mask);
    if (sigaction(g_signals[i], &action, &g_old_actions[i]) != 0) {
      memset(&g_old_actions[i], 0, sizeof(g_old_actions[i]));
    }
  }
  g_installed = 1;
}
