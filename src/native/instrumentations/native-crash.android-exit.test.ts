import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';
import { installNativeCrashReader } from './native-crash';

type Platform = ReturnType<typeof memoryPlatform>;
type Report = Record<string, unknown>;

const iso = (ms: number) => new Date(ms).toISOString();

async function makeScout(platform: Platform = memoryPlatform()) {
  const s = new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
    } as never,
    platform,
  );
  await s.bootstrap();
  return s;
}

function fakeCrashModule(reports: Report[]) {
  const pending = [...reports];
  return {
    getPendingCrashes: vi.fn(async () => [...pending]),
    clearPendingCrashes: vi.fn(async () => {
      pending.length = 0;
    }),
    isInstalled: async () => true,
  };
}

// Shapes match what android/src/main/cpp/scout_signal_handler.c,
// ScoutCrashModule.kt (writeReport for uncaught exceptions) and
// ScoutExitInfoCollector.writeReport persist.
function ndk(atMs: number, pid: number): Report {
  return {
    'crash.type': 'ndk_signal',
    // The NDK handler writes whole seconds.
    'crash.timestamp': iso(Math.floor(atMs / 1000) * 1000),
    'crash.pid': pid,
    'crash.reason': 'SIGSEGV',
    'crash.signal': 'SIGSEGV',
    'crash.stack_trace': 'signal 11 at addr 0x8\n#0 pc 0x1234 libfoo.so',
  };
}

function jvm(atMs: number, pid?: number): Report {
  const r: Report = {
    'crash.type': 'uncaught_exception',
    'crash.reason': 'std::bad_alloc',
    'crash.nsexception_name': 'java.lang.OutOfMemoryError',
    'crash.stack_trace':
      'java.lang.OutOfMemoryError: std::bad_alloc\n\tat com.example.Foo.bar',
    'crash.thread': 'main',
    // The JVM writer stores epoch milliseconds as a string.
    'crash.timestamp': String(atMs),
  };
  if (pid !== undefined) r['crash.pid'] = pid;
  return r;
}

function exitRecord(
  type: 'native_crash' | 'jvm_crash' | 'anr',
  pid: number,
  deathMs: number,
  tombstone?: string,
): Report {
  const r: Report = {
    'crash.type': type,
    'crash.source': 'exit_info',
    'crash.os_reason_name':
      type === 'native_crash' ? 'crash_native' : type === 'anr' ? 'anr' : 'crash',
    'crash.exit_status': 0,
    'crash.death_timestamp_ms': deathMs,
    'crash.process_name': 'com.example.app',
    'crash.pid': pid,
    'crash.reason': 'crash',
    'crash.timestamp': iso(deathMs),
  };
  if (tombstone !== undefined) r['crash.tombstone'] = tombstone;
  return r;
}

describe('Android: exit-info records of crashes already reported in-process', () => {
  let rec: Recorder;
  beforeEach(() => {
    rec = makeRecorder();
  });
  const crashSpans = () => rec.spans().filter((s) => s.name === SPAN.NATIVE_CRASH);
  const typeOf = (s: ReadableSpan) => s.attributes[ATTR.CRASH_TYPE];
  const t0 = Date.now() - 60 * 60 * 1000;

  it('a native crash and its exit record count once, keeping the OS tombstone', async () => {
    const s = await makeScout();
    await installNativeCrashReader(
      s,
      fakeCrashModule([
        ndk(t0, 31659),
        exitRecord('native_crash', 31659, t0 + 1400, 'TOMBSTONE'),
      ]),
    );
    const spans = crashSpans();
    expect(spans).toHaveLength(1);
    expect(typeOf(spans[0]!)).toBe('ndk_signal');
    expect(spans[0]!.attributes['crash.tombstone']).toBe('TOMBSTONE');
    // The in-app report's own stack stays.
    expect(String(spans[0]!.attributes[ATTR.ERROR_STACK_TRACE])).toContain('signal 11');
  });

  it('a JVM crash without a pid and its exit record count once', async () => {
    const s = await makeScout();
    await installNativeCrashReader(
      s,
      fakeCrashModule([jvm(t0), exitRecord('jvm_crash', 11452, t0 + 20)]),
    );
    const spans = crashSpans();
    expect(spans).toHaveLength(1);
    expect(typeOf(spans[0]!)).toBe('uncaught_exception');
  });

  it('a JVM crash with a pid and its exit record count once', async () => {
    const s = await makeScout();
    await installNativeCrashReader(
      s,
      fakeCrashModule([jvm(t0, 4242), exitRecord('jvm_crash', 4242, t0 + 30)]),
    );
    expect(crashSpans()).toHaveLength(1);
  });

  it('two crashes in one session each absorb only their own exit record', async () => {
    const s = await makeScout();
    await installNativeCrashReader(
      s,
      fakeCrashModule([
        ndk(t0, 31659),
        ndk(t0 + 291_000, 13451),
        exitRecord('native_crash', 31659, t0 + 352, 'TOMBSTONE-A'),
        exitRecord('native_crash', 13451, t0 + 291_000 + 3166, 'TOMBSTONE-B'),
      ]),
    );
    const spans = crashSpans();
    expect(spans).toHaveLength(2);
    expect(spans.map((x) => x.attributes['crash.pid']).sort()).toEqual([13451, 31659]);
    const byPid = Object.fromEntries(
      spans.map((x) => [x.attributes['crash.pid'], x.attributes['crash.tombstone']]),
    );
    expect(byPid[31659]).toBe('TOMBSTONE-A');
    expect(byPid[13451]).toBe('TOMBSTONE-B');
  });

  it('keeps an exit record of another process', async () => {
    const s = await makeScout();
    await installNativeCrashReader(
      s,
      fakeCrashModule([ndk(t0, 100), exitRecord('native_crash', 200, t0 + 1000)]),
    );
    expect(crashSpans()).toHaveLength(2);
  });

  it('keeps an exit record of a death well after the in-app crash', async () => {
    const s = await makeScout();
    await installNativeCrashReader(
      s,
      fakeCrashModule([jvm(t0), exitRecord('jvm_crash', 300, t0 + 60_000)]),
    );
    expect(crashSpans()).toHaveLength(2);
  });

  it('keeps an exit record of a different kind of crash', async () => {
    // A native death doesn't duplicate a JVM report, and the reverse.
    const s = await makeScout();
    await installNativeCrashReader(
      s,
      fakeCrashModule([jvm(t0, 400), exitRecord('native_crash', 400, t0 + 500)]),
    );
    expect(crashSpans()).toHaveLength(2);
  });

  it('keeps a crash that only the OS recorded', async () => {
    // e.g. a crash before the SDK installed its handlers.
    const s = await makeScout();
    await installNativeCrashReader(
      s,
      fakeCrashModule([exitRecord('jvm_crash', 500, t0)]),
    );
    const spans = crashSpans();
    expect(spans).toHaveLength(1);
    expect(typeOf(spans[0]!)).toBe('jvm_crash');
  });

  it('drops the exit record when the in-app crash was reported on an earlier launch', async () => {
    const platform = memoryPlatform();
    const first = await makeScout(platform);
    await installNativeCrashReader(first, fakeCrashModule([ndk(t0, 600)]));
    rec = makeRecorder();
    const later = await makeScout(platform);
    await installNativeCrashReader(
      later,
      fakeCrashModule([exitRecord('native_crash', 600, t0 + 900)]),
    );
    expect(crashSpans()).toHaveLength(0);
  });

  it('reports an exit record only once when it is delivered again', async () => {
    // The exit-info watermark is saved asynchronously, so a crash loop can
    // hand the same record to two launches.
    const platform = memoryPlatform();
    const first = await makeScout(platform);
    await installNativeCrashReader(
      first,
      fakeCrashModule([exitRecord('jvm_crash', 7167, t0)]),
    );
    expect(crashSpans()).toHaveLength(1);
    rec = makeRecorder();
    const later = await makeScout(platform);
    await installNativeCrashReader(
      later,
      fakeCrashModule([exitRecord('jvm_crash', 7167, t0)]),
    );
    expect(crashSpans()).toHaveLength(0);
  });

  it('leaves exit-info ANRs and low-memory app exits alone', async () => {
    const s = await makeScout();
    const lowMemory = {
      ...exitRecord('jvm_crash', 800, t0),
      'crash.type': 'low_memory',
      'scout.span': 'app_exit',
    };
    await installNativeCrashReader(
      s,
      fakeCrashModule([jvm(t0, 800), exitRecord('anr', 800, t0 + 100), lowMemory]),
    );
    expect(crashSpans().map(typeOf).sort()).toEqual(['anr', 'uncaught_exception']);
    expect(rec.spans().filter((x) => x.name === SPAN.APP_EXIT)).toHaveLength(1);
  });

  it('leaves iOS reports untouched', async () => {
    const s = await makeScout();
    await installNativeCrashReader(
      s,
      fakeCrashModule([
        {
          'crash.type': 'kscrash',
          'crash.timestamp': iso(t0),
          'crash.signal': 'SIGSEGV',
          'crash.reason': 'x',
        },
      ]),
    );
    expect(crashSpans()).toHaveLength(1);
  });
});
