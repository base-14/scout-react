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

    it('never drops a SIGKILL report, which no in-process handler can catch', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          kscrash(crashAt),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            signal: '9',
            exceptionType: '10',
          }),
        ]),
      );
      expect(crashSpans().map(typeOf).sort()).toEqual(['kscrash', 'metric_kit_crash']);
    });

    it('never drops a watchdog termination', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          kscrash(crashAt),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            terminationReason: 'Namespace SPRINGBOARD, Code 0x8badf00d',
          }),
        ]),
      );
      expect(crashSpans().map(typeOf).sort()).toEqual(['kscrash', 'metric_kit_crash']);
    });

    it('drops the copy whose signal matches, not another crash in the same window', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          {
            'crash.type': 'nsexception',
            'crash.reason': 'boom',
            'crash.nsexception_name': 'NSInvalidArgumentException',
            'crash.timestamp': iso(crashAt),
          },
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            exceptionType: '1',
            signal: '11',
          }),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            exceptionType: '10',
            signal: '6',
          }),
        ]),
      );
      const metricKit = crashSpans().filter((x) => typeOf(x) === 'metric_kit_crash');
      expect(crashSpans().map(typeOf).sort()).toEqual([
        'metric_kit_crash',
        'nsexception',
      ]);
      expect(metricKit[0]!.attributes[ATTR.CRASH_REASON]).toBe(
        'EXC_BAD_ACCESS (SIGSEGV)',
      );
    });

    it('an in-process signal does not absorb a MetricKit report with a different signal', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          kscrash(crashAt),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            exceptionType: '10',
            signal: '6',
          }),
        ]),
      );
      expect(crashSpans().map(typeOf).sort()).toEqual(['kscrash', 'metric_kit_crash']);
    });

    it('a report with a known signal is matched before one without, whatever the order', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          kscrash(crashAt),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            terminationReason: 'Namespace SIGNAL, Code 0xb',
          }),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            exceptionType: '1',
            signal: '11',
          }),
        ]),
      );
      const metricKit = crashSpans().filter((x) => typeOf(x) === 'metric_kit_crash');
      expect(metricKit).toHaveLength(1);
      expect(metricKit[0]!.attributes['crash.signal']).toBeUndefined();
    });

    it('still matches an in-process crash saved by an earlier SDK version', async () => {
      const platform = memoryPlatform();
      const crashAt = Date.now() - 2 * HOUR;
      // Saved before signal and type were stored: time and version only.
      await platform.setItem(
        'scout.ios.in_process_crashes',
        JSON.stringify([{ t: crashAt, v: '2.3.0' }]),
      );
      const s = await makeScout(platform);
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          metricKitCrash(crashAt - HOUR, crashAt + HOUR, {
            exceptionType: '1',
            signal: '11',
          }),
        ]),
      );
      expect(crashSpans()).toHaveLength(0);
    });

    it('two in-process crashes absorb two of three MetricKit reports', async () => {
      const crashAt = Date.now() - 2 * HOUR;
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          kscrash(crashAt),
          kscrash(crashAt + 60_000),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR),
          metricKitCrash(crashAt - HOUR, crashAt + HOUR),
        ]),
      );
      expect(crashSpans().filter((x) => typeOf(x) === 'metric_kit_crash')).toHaveLength(
        1,
      );
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
      expect(span!.attributes['crash.timestamp_source']).toBe('metric_kit_payload_begin');
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

    it('is put in the session that was running when it crashed', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const t0 = Date.now();
        const s = await makeScout();
        const crashed = s.commonAttributes()[ATTR.SESSION_ID];
        // A later launch: a new session reads the report.
        vi.setSystemTime(t0 + 3 * HOUR);
        await s.sessionManager.rotate();
        const reading = s.commonAttributes()[ATTR.SESSION_ID];
        expect(reading).not.toBe(crashed);
        await installNativeCrashReader(
          s,
          fakeCrashModule([metricKitCrash(t0 + 60_000, t0 + 60_000)]),
        );
        const [span] = crashSpans();
        expect(span!.attributes[ATTR.SESSION_ID]).toBe(crashed);
        expect(span!.attributes[ATTR.SESSION_START_TIME]).toBe(iso(t0));
        expect(span!.attributes['crash.session_source']).toBe('crash_time');
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the reading session, marked as such, when no recorded session covers it', async () => {
      // RUM leaves crashes without a session out of the crash list and counts.
      const s = await makeScout();
      const reading = s.commonAttributes()[ATTR.SESSION_ID];
      await installNativeCrashReader(
        s,
        fakeCrashModule([metricKitCrash(Date.now() - 3 * HOUR, Date.now() - 3 * HOUR)]),
      );
      const [span] = crashSpans();
      expect(span!.attributes[ATTR.SESSION_ID]).toBe(reading);
      expect(span!.attributes['crash.session_source']).toBe('delivery');
    });
  });

  describe('grouping', () => {
    // Shaped like RunningBoard's text; ids, pids and timings differ per report.
    const watchdog = (explanation: string, pid: number, uuid: string) =>
      `<RBSTerminateContext| domain:10 code:0x8BADF00D explanation:${explanation.replace('APP', `app<com.example.app(${uuid})>:${pid}`)}\n` +
      'ProcessVisibility: Foreground\nProcessState: Running\nWatchdogEvent: scene-create\n' +
      'WatchdogCPUStatistics: (\n"Elapsed total CPU time (seconds): 15.180 (user 8.460, system 6.720), 12% CPU"\n) reportType:CrashLog>';
    const SCENE_CREATE =
      'scene-create watchdog transgression: APP exhausted real (wall clock) time allowance of 19.89 seconds';

    it('watchdog kills of one cause share one title', async () => {
      const s = await makeScout();
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          metricKitCrash(Date.now() - 3 * HOUR, Date.now() - 3 * HOUR, {
            signal: '9',
            exceptionType: '10',
            terminationReason: watchdog(
              SCENE_CREATE,
              21162,
              'FEEDEEEE-DDDD-CCCC-BBBB-0000000001F5',
            ),
          }),
          metricKitCrash(Date.now() - 2 * HOUR, Date.now() - 2 * HOUR, {
            signal: '9',
            exceptionType: '10',
            terminationReason: watchdog(
              SCENE_CREATE.replace('19.89', '10.00'),
              874,
              'C4A1B2C3-1234-4ABC-9DEF-0123456789AB',
            ),
          }),
        ]),
      );
      const spans = crashSpans();
      expect(spans).toHaveLength(2);
      for (const span of spans) {
        expect(span.attributes[ATTR.CRASH_REASON]).toBe('Watchdog: scene-create timeout');
        // The full text stays on the span for the detail view.
        expect(span.attributes['crash.termination_reason']).toContain('0x8BADF00D');
      }
    });

    it('names each watchdog cause', async () => {
      const s = await makeScout();
      const reasons = [
        watchdog(
          'scene-update watchdog transgression: APP exhausted real (wall clock) time allowance of 9.90 seconds',
          1,
          'A',
        ),
        '<RBSTerminateContext| domain:10 code:0x8BADF00D explanation:[app<com.example.app>:4410] Failed to terminate gracefully after 5.0s\nProcessVisibility: Unknown>',
        'Namespace SPRINGBOARD, Code 0x8badf00d',
      ];
      await installNativeCrashReader(
        s,
        fakeCrashModule(
          reasons.map((r) =>
            metricKitCrash(Date.now() - 3 * HOUR, Date.now() - 3 * HOUR, {
              signal: '9',
              terminationReason: r,
            }),
          ),
        ),
      );
      expect(crashSpans().map((x) => x.attributes[ATTR.CRASH_REASON])).toEqual([
        'Watchdog: scene-update timeout',
        'Watchdog: failed to terminate',
        'Watchdog termination',
      ]);
    });

    it('other termination reasons lose their per-report ids', async () => {
      const s = await makeScout();
      const reason = (pid: number, uuid: string) =>
        `<RBSTerminateContext| domain:15 code:0xDEAD10CC explanation:app<com.example.app(${uuid})>:${pid} held a lock for 2.75 seconds\nProcessVisibility: Background>`;
      await installNativeCrashReader(
        s,
        fakeCrashModule([
          metricKitCrash(Date.now() - 3 * HOUR, Date.now() - 3 * HOUR, {
            signal: '9',
            terminationReason: reason(120, '11111111-2222-4333-8444-555555555555'),
          }),
          metricKitCrash(Date.now() - 2 * HOUR, Date.now() - 2 * HOUR, {
            signal: '9',
            terminationReason: reason(4321, '66666666-7777-4888-9999-000000000000'),
          }),
        ]),
      );
      const [a, b] = crashSpans().map((x) => x.attributes[ATTR.CRASH_REASON]);
      expect(a).toBe(b);
      expect(a).toContain('0xDEAD10CC');
      expect(a).not.toMatch(/4321|120|1111|2\.75/);
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
      const anr = rec.spans().filter((x) => x.name === SPAN.ANR);
      expect(anr).toHaveLength(1);
      // No recorded session covers its window, so it stays visible in the reading one.
      expect(anr[0]!.attributes[ATTR.SESSION_ID]).toBe(
        s.commonAttributes()[ATTR.SESSION_ID],
      );
      expect(anr[0]!.attributes['crash.session_source']).toBe('delivery');
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
