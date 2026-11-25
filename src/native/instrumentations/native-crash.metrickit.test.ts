import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';
import { installNativeCrashReader } from './native-crash';

type Platform = ReturnType<typeof memoryPlatform>;
type Report = Record<string, unknown>;

const HOUR = 3_600_000;
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

// Shapes match what ios/ScoutKSCrashIntegration.swift and
// ios/ScoutCrashModule.swift (writeCrashReport / writeHangReport) persist.
function kscrash(atMs: number, version = '2.3.0', build = '145'): Report {
  return {
    'crash.type': 'kscrash',
    'crash.timestamp': iso(atMs),
    'crash.signal': 'SIGSEGV',
    'crash.reason': 'EXC_BAD_ACCESS',
    'crash.application_version': version,
    'crash.app_version': version,
    'crash.application_build_version': build,
    'crash.stack_trace': 'frame0\nframe1',
  };
}

function metricKitCrash(
  windowStartMs: number,
  windowEndMs: number,
  opts: {
    version?: string;
    build?: string;
    signal?: string;
    exceptionType?: string;
    terminationReason?: string;
    deliveredAtMs?: number;
  } = {},
): Report {
  const r: Report = {
    'crash.type': 'metric_kit_crash',
    // The SDK stamps delivery time here today (Date() in writeCrashReport).
    'crash.timestamp': iso(opts.deliveredAtMs ?? Date.now()),
    'crash.application_version': opts.version ?? '2.3.0',
    'crash.app_version': opts.version ?? '2.3.0',
    'crash.application_build_version': opts.build ?? '145',
    'crash.diagnostic_payload_time_begin': iso(windowStartMs),
    'crash.diagnostic_payload_time_end': iso(windowEndMs),
    'crash.callstack_tree_json': 'e30=',
    'crash.stack_trace': 'e30=',
    'crash.callstack_tree_encoding': 'base64',
  };
  if (opts.signal !== undefined) r['crash.signal'] = opts.signal;
  if (opts.exceptionType !== undefined) r['crash.exception_type'] = opts.exceptionType;
  if (opts.terminationReason !== undefined)
    r['crash.termination_reason'] = opts.terminationReason;
  return r;
}

function metricKitHang(windowStartMs: number, windowEndMs: number): Report {
  return {
    'crash.type': 'metric_kit_hang',
    'crash.timestamp': iso(Date.now()),
    'crash.reason': 'App hang 2500ms',
    'crash.hang_duration_ms': 2500,
    'crash.application_version': '2.3.0',
    'crash.app_version': '2.3.0',
    'crash.diagnostic_payload_time_begin': iso(windowStartMs),
    'crash.diagnostic_payload_time_end': iso(windowEndMs),
    'crash.stack_trace': 'e30=',
  };
}

const startMs = (s: ReadableSpan) => s.startTime[0] * 1000 + s.startTime[1] / 1e6;

describe('iOS MetricKit crashes', () => {
  let rec: Recorder;
  beforeEach(() => {
    rec = makeRecorder();
  });
  const crashSpans = () => rec.spans().filter((s) => s.name === SPAN.NATIVE_CRASH);
  const typeOf = (s: ReadableSpan) => s.attributes[ATTR.CRASH_TYPE];

  describe('duplicates', () => {
    it('a crash caught in-process and by MetricKit counts once', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          kscrash(crashAt),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR),
        ]),
      );
      expect(crashSpans().map(typeOf)).toEqual(['kscrash']);
    });

    it('a MetricKit copy delivered on a later launch is still dropped', async () => {
      const platform = memoryPlatform();
      const crashAt = Date.now() - 2 * HOUR;
      const s1 = await makeScout(platform);
      await installNativeCrashReader(s1, fakeCrashModule([kscrash(crashAt)]));
      expect(crashSpans().map(typeOf)).toEqual(['kscrash']);

      rec.reset();
      const s2 = await makeScout(platform);
      await installNativeCrashReader(
        s2,
        fakeCrashModule([metricKitCrash(crashAt - HOUR, crashAt + HOUR)]),
      );
      expect(crashSpans()).toHaveLength(0);
    });

    it('a signal-handler crash without an app version still absorbs its MetricKit copy', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          {
            'crash.type': 'signal',
            'crash.signal': 'SIGSEGV',
            'crash.thread': 'main',
            'crash.timestamp': iso(crashAt),
          },
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            exceptionType: '1',
            signal: '11',
          }),
        ]),
      );
      expect(crashSpans().map(typeOf)).toEqual(['signal']);
    });

    it('one in-process crash absorbs only one MetricKit crash', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          kscrash(crashAt),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR),
        ]),
      );
      expect(crashSpans().map(typeOf).sort()).toEqual(['kscrash', 'metric_kit_crash']);
    });

    it('a MetricKit crash with no in-process match is still reported (e.g. watchdog kill)', async () => {
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          metricKitCrash(Date.now() - 3 * HOUR, Date.now() - HOUR, {
            terminationReason: 'Namespace SPRINGBOARD, Code 0x8badf00d',
          }),
        ]),
      );
      expect(crashSpans().map(typeOf)).toEqual(['metric_kit_crash']);
    });

    it('an in-process crash of another app version does not absorb a MetricKit crash', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          kscrash(crashAt, '2.4.0', '150'),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            version: '2.3.0',
            build: '145',
          }),
        ]),
      );
      expect(crashSpans().map(typeOf).sort()).toEqual(['kscrash', 'metric_kit_crash']);
    });

    it('an in-process crash outside the MetricKit window does not absorb it', async () => {
      const crashAt = Date.now() - 10 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          kscrash(crashAt),
          metricKitCrash(Date.now() - 3 * HOUR, Date.now() - HOUR),
        ]),
      );
      expect(crashSpans().map(typeOf).sort()).toEqual(['kscrash', 'metric_kit_crash']);
    });
  });

  describe('version and time', () => {
    it('is placed at the crash window, not the time it was delivered', async () => {
      const windowStart = Date.now() - 26 * HOUR;
      const windowEnd = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          metricKitCrash(windowStart, windowEnd, { deliveredAtMs: Date.now() }),
        ]),
      );
      const [span] = crashSpans();
      expect(span).toBeDefined();
      expect(Math.abs(startMs(span!) - windowStart)).toBeLessThan(1000);
      expect(span!.attributes[ATTR.CRASH_TIMESTAMP]).toBe(iso(windowStart));
    });

    it("carries the crash's own app version and build", async () => {
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          metricKitCrash(Date.now() - 3 * HOUR, Date.now() - HOUR, {
            version: '2.2.0',
            build: '120',
          }),
        ]),
      );
      const [span] = crashSpans();
      expect(span!.attributes['crash.app_version']).toBe('2.2.0');
      expect(span!.attributes['crash.application_build_version']).toBe('120');
    });

    it('is not attributed to the session that delivered it', async () => {
      const s = await makeScout();
      const current = s.commonAttributes()[ATTR.SESSION_ID];
      expect(current).toBeTruthy();
      await installNativeCrashReader(
        s,
        fakeCrashModule([metricKitCrash(Date.now() - 3 * HOUR, Date.now() - HOUR)]),
      );
      const [span] = crashSpans();
      expect(span).toBeDefined();
      expect(span!.attributes[ATTR.SESSION_ID]).not.toBe(current);
    });
  });

  describe('grouping', () => {
    it('gets a reason from the termination reason', async () => {
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          metricKitCrash(Date.now() - 3 * HOUR, Date.now() - HOUR, {
            terminationReason: 'Namespace SPRINGBOARD, Code 0x8badf00d',
          }),
        ]),
      );
      expect(crashSpans()[0]!.attributes[ATTR.CRASH_REASON]).toContain('0x8badf00d');
    });

    it('gets a reason from the exception type and signal', async () => {
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          metricKitCrash(Date.now() - 3 * HOUR, Date.now() - HOUR, {
            exceptionType: '1',
            signal: '11',
          }),
        ]),
      );
      const reason = String(crashSpans()[0]!.attributes[ATTR.CRASH_REASON]);
      expect(reason).toContain('EXC_BAD_ACCESS');
      expect(reason).toContain('SIGSEGV');
    });

    it('different causes get different reasons', async () => {
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          metricKitCrash(Date.now() - 3 * HOUR, Date.now() - HOUR, {
            exceptionType: '1',
            signal: '11',
          }),
          metricKitCrash(Date.now() - 3 * HOUR, Date.now() - HOUR, {
            exceptionType: '10',
            signal: '6',
          }),
        ]),
      );
      const reasons = crashSpans().map((x) => x.attributes[ATTR.CRASH_REASON]);
      expect(reasons).toHaveLength(2);
      expect(reasons[0]).toBeTruthy();
      expect(reasons[0]).not.toBe(reasons[1]);
    });
  });

  describe('hangs', () => {
    it('a MetricKit hang is not counted as a crash', async () => {
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([metricKitHang(Date.now() - 3 * HOUR, Date.now() - HOUR)]),
      );
      expect(crashSpans()).toHaveLength(0);
      expect(rec.spans().filter((x) => x.name === SPAN.ANR)).toHaveLength(1);
    });
  });

  describe('in-process crashes are unchanged', () => {
    it('are reported once with their own time and reason', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(s, fakeCrashModule([kscrash(crashAt)]));
      const [span] = crashSpans();
      expect(crashSpans()).toHaveLength(1);
      expect(span!.attributes[ATTR.CRASH_TIMESTAMP]).toBe(iso(crashAt));
      expect(span!.attributes[ATTR.CRASH_REASON]).toBe('EXC_BAD_ACCESS');
    });
  });
});
