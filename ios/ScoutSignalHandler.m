#import "ScoutSignalHandler.h"

#import <execinfo.h>
#import <fcntl.h>
#import <signal.h>
#import <stdint.h>
#import <string.h>
#import <sys/time.h>
#import <unistd.h>

#define SCOUT_MAX_PATH 1024
#define SCOUT_NUM_SIGNALS 6

static char g_crashDirPath[SCOUT_MAX_PATH] = {0};
static struct sigaction g_oldActions[SCOUT_NUM_SIGNALS];
static const int g_handledSignals[SCOUT_NUM_SIGNALS] = {
    SIGSEGV, SIGABRT, SIGBUS, SIGILL, SIGFPE, SIGTRAP
};
static const char *const g_signalNames[SCOUT_NUM_SIGNALS] = {
    "SIGSEGV", "SIGABRT", "SIGBUS", "SIGILL", "SIGFPE", "SIGTRAP"
};
static volatile int g_installed = 0;

static void writeAllFd(int fd, const char *buf, size_t len) {
  while (len > 0) {
    ssize_t w = write(fd, buf, len);
    if (w < 0) return;
    if ((size_t)w >= len) return;
    buf += w; len -= (size_t)w;
  }
}

static void writeStr(int fd, const char *s) {
  size_t n = 0;
  while (s[n]) n++;
  writeAllFd(fd, s, n);
}

static void writeIntDecimal(int fd, long n) {
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
  writeAllFd(fd, buf, (size_t)i);
}

static void writeHex64(int fd, uint64_t v) {
  char buf[18];
  buf[0] = '0'; buf[1] = 'x';
  for (int i = 0; i < 16; i++) {
    int shift = (15 - i) * 4;
    int nibble = (int)((v >> shift) & 0xF);
    buf[2 + i] = (nibble < 10) ? (char)('0' + nibble) : (char)('a' + nibble - 10);
  }
  writeAllFd(fd, buf, sizeof(buf));
}

static const char *signalNameFor(int sig) {
  for (int i = 0; i < SCOUT_NUM_SIGNALS; i++) {
    if (g_handledSignals[i] == sig) return g_signalNames[i];
  }
  return "UNKNOWN";
}

static int oldActionIndexFor(int sig) {
  for (int i = 0; i < SCOUT_NUM_SIGNALS; i++) {
    if (g_handledSignals[i] == sig) return i;
  }
  return -1;
}

static void buildReportPath(int sig, char *out, size_t outSize) {
  size_t dlen = strlen(g_crashDirPath);
  if (dlen + 40 >= outSize) {
    out[0] = 0;
    return;
  }
  memcpy(out, g_crashDirPath, dlen);
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

static void scoutSignalHandler(int sig, siginfo_t *info, void *uap) {
  (void)uap;

  char path[SCOUT_MAX_PATH + 64];
  buildReportPath(sig, path, sizeof(path));
  int fd = -1;
  if (path[0] != 0) {
    fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  }
  if (fd < 0) goto chain;

  writeStr(fd, "{\"crash.type\":\"signal\",\"crash.signal\":\"");
  writeStr(fd, signalNameFor(sig));
  writeStr(fd, "\",\"crash.signal_code\":");
  writeIntDecimal(fd, info ? (long)info->si_code : 0L);
  writeStr(fd, ",\"crash.signal_address\":\"");
  writeHex64(fd, info ? (uint64_t)(uintptr_t)info->si_addr : 0ULL);
  writeStr(fd, "\",\"crash.thread\":\"main\",\"crash.timestamp\":\"");
  
  struct timeval tv;
  if (gettimeofday(&tv, NULL) == 0) {
    writeIntDecimal(fd, (long)tv.tv_sec);
  } else {
    writeStr(fd, "0");
  }
  writeStr(fd, "\",\"crash.stack_trace\":\"");
  
  void *frames[64];
  int nframes = backtrace(frames, 64);
  for (int i = 0; i < nframes; i++) {
    if (i > 0) writeStr(fd, "\\n");
    writeHex64(fd, (uint64_t)(uintptr_t)frames[i]);
  }
  writeStr(fd, "\"}");
  close(fd);

chain:
  
  
  
  int idx = oldActionIndexFor(sig);
  if (idx >= 0) {
    sigaction(sig, &g_oldActions[idx], NULL);
  } else {
    signal(sig, SIG_DFL);
  }
  raise(sig);
}

void ScoutSignalHandlerInstall(NSString *crashDir) {
  if (g_installed) return;
  if (crashDir == nil) return;
  const char *cstr = [crashDir UTF8String];
  if (cstr == NULL) return;

  size_t len = strlen(cstr);
  if (len >= SCOUT_MAX_PATH) return;
  memcpy(g_crashDirPath, cstr, len);
  g_crashDirPath[len] = 0;

  for (int i = 0; i < SCOUT_NUM_SIGNALS; i++) {
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_flags = SA_SIGINFO;
    action.sa_sigaction = scoutSignalHandler;
    sigemptyset(&action.sa_mask);
    if (sigaction(g_handledSignals[i], &action, &g_oldActions[i]) != 0) {
      
      
      memset(&g_oldActions[i], 0, sizeof(g_oldActions[i]));
    }
  }
  g_installed = 1;
}
