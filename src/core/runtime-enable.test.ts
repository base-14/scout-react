import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Scout } from './scout';
import { ATTR } from './attributes';
import { SPAN } from './spans';
import { EnabledGate, GatedSpanProcessor, gateExporter } from './enabled-gate';
import {
  DISABLED_PERIODS_KEY,
  DisabledPeriods,
  crashHappenedWhileDisabled,
  crashReportTime,
} from './disabled-periods';
import { installNativeCrashReader } from '../native/instrumentations/native-crash';
import { makeRecorder, memoryPlatform, type Recorder } from '../test/recorder';

type Platform = ReturnType<typeof memoryPlatform>;
const SESSION_KEY = 'scout.session';

function newScout(
  overrides: Record<string, unknown> = {},
  platform: Platform = memoryPlatform(),
) {
  return new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
      ...overrides,
    } as never,
    platform,
  );
}

async function makeScout(
  overrides: Record<string, unknown> = {},
  platform: Platform = memoryPlatform(),
) {
  const s = newScout(overrides, platform);
  await s.bootstrap();
  return s;
}

/** Drives every public emit path once. */
function emitEverything(s: Scout) {
  s.emitSpan('screen_view', s.commonAttributes());
  s.emitSpan(SPAN.ERROR, s.commonAttributes());
  s.emitSpan(SPAN.APP_UNCLEAN_EXIT, s.commonAttributes(), { forceSample: true });
  s.logEvent('custom');
  s.addTiming('t');
  s.recordOperationStep('op', 'start');
  s.reportError(new Error('handled'));
  s.reportUncaught(new Error('fatal'));
  s.logInfo('info');
  s.logError('error log');
  s.emitLog('ERROR', 'forced', {}, { forceSample: true });
  s.emitHistogram('h', 1);
  s.emitGauge('g', 1);
  s.addBreadcrumb('tap', 'crumb');
}

async function metricNames(rec: Recorder) {
  return (await rec.metrics())
    .flatMap((r) => r.scopeMetrics)
    .flatMap((sm) => sm.metrics)
    .filter((m) => m.dataPoints.length > 0)
    .map((m) => m.descriptor.name);
}

describe('runtime enable: init with enabled=false', () => {
  let rec: Recorder;
  beforeEach(() => {
    rec = makeRecorder();
  });

  it('defaults to enabled and behaves as before', async () => {
    const s = await makeScout();
    expect(s.enabled).toBe(true);
    expect(s.config.enabled).toBe(true);
    expect(s.sessionId).toBeTruthy();
    s.emitSpan('screen_view', s.commonAttributes());
    expect(rec.spans()).toHaveLength(1);
  });

  it('creates no session and persists nothing for it', async () => {
    const platform = memoryPlatform();
    const s = await makeScout({ enabled: false }, platform);
    expect(s.enabled).toBe(false);
    expect(s.sessionId).toBeNull();
    expect(s.sessionManager.isSuspended).toBe(true);
    expect(await platform.getItem(SESSION_KEY)).toBeNull();
  });

  it('leaves a persisted, still-resumable session untouched (no lastActive bump)', async () => {
    const platform = memoryPlatform();
    const stored = JSON.stringify({
      id: 'persisted',
      startedAt: Date.now() - 60_000,
      lastActiveAt: Date.now() - 30_000,
      sampled: true,
      samplingSource: 'fallback',
    });
    await platform.setItem(SESSION_KEY, stored);
    const s = await makeScout({ enabled: false }, platform);
    s.sessionManager.touch();
    await s.sessionManager.maybeRotateOnResume();
    expect(s.sessionId).toBeNull();
    expect(await platform.getItem(SESSION_KEY)).toBe(stored);
  });

  it('exports nothing at all: spans, errors, logs, metrics', async () => {
    const s = await makeScout({ enabled: false });
    emitEverything(s);
    expect(s.startTrackedSpan('http.request')).toBeNull();
    expect(s.startRootSpan('view')).toBeNull();
    expect(s.startChildSpan('child')).toBeNull();
    expect(rec.spans()).toHaveLength(0);
    expect(rec.logs()).toHaveLength(0);
    expect(await metricNames(rec)).toEqual([]);
  });

  it('drops errors and crashes even with alwaysCaptureErrors on', async () => {
    const s = await makeScout({ enabled: false, alwaysCaptureErrors: true });
    s.reportError(new Error('x'));
    s.reportUncaught(new Error('y'));
    s.emitSpan(SPAN.APP_CRASH, s.commonAttributes());
    s.emitSpan(SPAN.NATIVE_CRASH, s.commonAttributes());
    s.logError('z');
    expect(rec.spans()).toHaveLength(0);
    expect(rec.logs()).toHaveLength(0);
  });

  it('records no breadcrumbs for a later report', async () => {
    const s = await makeScout({ enabled: false });
    s.addBreadcrumb('tap', 'while disabled');
    s.breadcrumbsManager.add('anr', 'direct');
    expect(s.breadcrumbsManager.list()).toEqual([]);
  });

  it('logs the init state with debug on', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await makeScout({ enabled: false, debug: true });
    expect(
      log.mock.calls.some(
        (c) => c[0] === '[scout]' && /enabled=false/.test(String(c[1])),
      ),
    ).toBe(true);
    log.mockRestore();
  });
});

describe('runtime enable: transitions', () => {
  let rec: Recorder;
  beforeEach(() => {
    rec = makeRecorder();
  });

  it('enabled → disabled flushes first, then ends the session and drops everything', async () => {
    const platform = memoryPlatform();
    const s = await makeScout({}, platform);
    const before = s.sessionId;
    expect(await platform.getItem(SESSION_KEY)).not.toBeNull();
    const order: string[] = [];
    s.onEnabledChange(async (enabled) => {
      order.push(
        `listener:${enabled}:session=${s.sessionManager.isSuspended ? 'ended' : 'live'}`,
      );
    });
    s.emitSpan('screen_view', s.commonAttributes());
    await s.setEnabled(false);
    expect(order).toEqual(['listener:false:session=live']);
    expect(s.enabled).toBe(false);
    expect(s.sessionId).toBeNull();
    // The ended session can never be resumed by a later launch.
    expect(await platform.getItem(SESSION_KEY)).toBeNull();
    rec.reset();
    emitEverything(s);
    expect(rec.spans()).toHaveLength(0);
    expect(rec.logs()).toHaveLength(0);
    expect(before).toBeTruthy();
  });

  it('drops vitals started while enabled and ended after the disable', async () => {
    const s = await makeScout();
    s.startVital('checkout');
    await s.setEnabled(false);
    s.endVital('checkout');
    await s.setEnabled(true);
    s.endVital('checkout');
    expect(rec.spans().filter((x) => x.name === SPAN.APP_VITAL)).toHaveLength(0);
  });

  it('a tracked span ending after the disable does not touch the session', async () => {
    const s = await makeScout();
    const tracked = s.startTrackedSpan('http.request');
    expect(tracked).not.toBeNull();
    await s.setEnabled(false);
    const touch = vi.spyOn(s.sessionManager, 'touch');
    tracked!.end();
    expect(touch).not.toHaveBeenCalled();
  });

  it('disabled → enabled always starts a fresh session, never the old one', async () => {
    const platform = memoryPlatform();
    const s = await makeScout({}, platform);
    const first = s.sessionId;
    await s.setEnabled(false);
    await s.setEnabled(true);
    expect(s.enabled).toBe(true);
    expect(s.sessionId).toBeTruthy();
    expect(s.sessionId).not.toBe(first);
    expect(JSON.parse((await platform.getItem(SESSION_KEY))!).id).toBe(s.sessionId);
    s.emitSpan('screen_view', s.commonAttributes());
    expect(rec.spans().at(-1)!.attributes[ATTR.SESSION_ID]).toBe(s.sessionId);
  });

  it('init disabled → enabled starts a fresh session even when a resumable one is persisted', async () => {
    const platform = memoryPlatform();
    await platform.setItem(
      SESSION_KEY,
      JSON.stringify({
        id: 'persisted',
        startedAt: Date.now() - 60_000,
        lastActiveAt: Date.now() - 1_000,
        sampled: true,
        samplingSource: 'fallback',
      }),
    );
    const s = await makeScout({ enabled: false }, platform);
    await s.setEnabled(true);
    expect(s.sessionId).toBeTruthy();
    expect(s.sessionId).not.toBe('persisted');
  });

  it('the fresh session resolves sampling from a pending userSampling set while disabled', async () => {
    const s = await makeScout({ enabled: false, sessionSampleRate: 100 });
    s.setUserSampling(false);
    await s.setEnabled(true);
    expect(s.sessionManager.samplingSource).toBe('user');
    expect(s.sessionManager.isSampled).toBe(false);
    s.emitSpan('screen_view', s.commonAttributes());
    expect(rec.spans()).toHaveLength(0);
  });

  it('the fresh session falls back to sessionSampleRate without a user value', async () => {
    const out = await makeScout({ enabled: false, sessionSampleRate: 0 });
    await out.setEnabled(true);
    expect(out.sessionManager.samplingSource).toBe('fallback');
    expect(out.sessionManager.isSampled).toBe(false);
    const kept = await makeScout({ enabled: false, sessionSampleRate: 100 });
    await kept.setEnabled(true);
    expect(kept.sessionManager.isSampled).toBe(true);
  });

  it('repeating the current value is a no-op (no rotation, no flush)', async () => {
    const s = await makeScout();
    const listener = vi.fn();
    s.onEnabledChange(listener);
    const id = s.sessionId;
    await s.setEnabled(true);
    expect(s.sessionId).toBe(id);
    expect(listener).not.toHaveBeenCalled();
    await s.setEnabled(false);
    await s.setEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a value set before bootstrap wins over config.enabled', async () => {
    const off = newScout({ enabled: true });
    void off.setEnabled(false);
    await off.bootstrap();
    expect(off.enabled).toBe(false);
    expect(off.sessionId).toBeNull();

    const on = newScout({ enabled: false });
    void on.setEnabled(true);
    await on.bootstrap();
    expect(on.enabled).toBe(true);
    expect(on.sessionId).toBeTruthy();
  });

  it('identity calls while disabled are kept and apply once enabled, without rotating', async () => {
    const s = await makeScout({ enabled: false });
    const rotate = vi.spyOn(s.sessionManager, 'rotate');
    s.setUser('alice', { plan: 'pro' });
    s.setUser('bob');
    s.setAccount('acme');
    expect(rotate).not.toHaveBeenCalled();
    expect(s.sessionId).toBeNull();
    rotate.mockRestore();
    await s.setEnabled(true);
    s.emitSpan('screen_view', s.commonAttributes());
    const attrs = rec.spans()[0]!.attributes;
    expect(attrs[ATTR.USER_ID]).toBe('bob');
    expect(attrs[ATTR.ACCOUNT_ID]).toBe('acme');
  });

  it('lifecycle resume while disabled neither creates nor rotates a session', async () => {
    const s = await makeScout();
    await s.setEnabled(false);
    expect(await s.sessionManager.maybeRotateOnResume()).toBe(false);
    expect(s.sessionId).toBeNull();
  });

  it('logs each transition with debug on', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const s = await makeScout({ debug: true });
    await s.setEnabled(false);
    await s.setEnabled(true);
    const lines = log.mock.calls.filter((c) => c[0] === '[scout]' && c[1] === 'enabled');
    expect(lines.map((c) => c[2])).toEqual([false, true]);
    log.mockRestore();
  });
});

describe('runtime enable: pipeline gate', () => {
  afterEach(() => {
    trace.disable();
  });

  // Built before the Scout, as initialize() does, so the core's tracer
  // resolves to this provider.
  function gatedPipeline() {
    const gate = new EnabledGate(true);
    const network = vi.fn((_items: unknown, cb: (r: { code: number }) => void) =>
      cb({ code: 0 }),
    );
    const exporter = new InMemorySpanExporter();
    const sent: string[] = [];
    const inner = {
      export: (spans: Array<{ name: string }>, cb: (r: { code: number }) => void) => {
        sent.push(...spans.map((x) => x.name));
        network(spans, cb);
        exporter.export(spans as never, () => {});
      },
      shutdown: async () => {},
    };
    gateExporter(inner, gate);
    trace.disable();
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({
        spanProcessors: [
          new GatedSpanProcessor(new SimpleSpanProcessor(inner as never), gate),
        ],
      }),
    );
    return { gate, network, sent };
  }

  it('drops spans started while enabled that end after the disable', async () => {
    const { gate, sent } = gatedPipeline();
    const s = await makeScout();
    gate.bind(s);
    s.emitSpan('before', s.commonAttributes());
    expect(sent).toEqual(['before']);
    sent.length = 0;
    const root = s.otelTracer.startSpan('view');
    const tracked = s.startTrackedSpan('http.request');
    await s.setEnabled(false);
    gate.setExporting(false);
    root.end();
    tracked!.end();
    expect(sent).toEqual([]);
  });

  it('a closed exporter makes no network call and reports success', async () => {
    const gate = new EnabledGate(false);
    const network = vi.fn();
    const exp = gateExporter({ export: network }, gate);
    const cb = vi.fn();
    exp.export([1], cb);
    expect(network).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith({ code: 0 });
    gate.setExporting(true);
    exp.export([1], cb);
    expect(network).toHaveBeenCalledTimes(1);
  });
});

describe('runtime enable: crashes while disabled are never replayed', () => {
  let rec: Recorder;
  beforeEach(() => {
    rec = makeRecorder();
  });

  function fakeCrashModule(reports: Array<Record<string, unknown>>) {
    const pending = [...reports];
    return {
      getPendingCrashes: vi.fn(async () => [...pending]),
      clearPendingCrashes: vi.fn(async () => {
        pending.length = 0;
      }),
      isInstalled: async () => true,
      pending,
    };
  }

  it('a crash during a disabled stretch of a process is dropped at the next enabled launch', async () => {
    const platform = memoryPlatform();
    const s1 = await makeScout({}, platform);
    const beforeDisable = Date.now() - 1;
    await s1.setEnabled(false);
    const whileDisabled = Date.now();
    // The process dies while disabled (open period), the next launch is enabled.
    const s2 = await makeScout({}, platform);
    const mod = fakeCrashModule([
      { 'crash.type': 'uncaught_exception', 'crash.timestamp': String(whileDisabled) },
      {
        'crash.type': 'signal',
        'crash.timestamp': new Date(beforeDisable).toISOString(),
      },
    ]);
    await installNativeCrashReader(s2, mod);
    const crashes = rec.spans().filter((x) => x.name === SPAN.NATIVE_CRASH);
    expect(crashes).toHaveLength(1);
    expect(crashes[0]!.attributes[ATTR.CRASH_TYPE]).toBe('signal');
    // Both are cleared: the dropped one is gone for good, not left for later.
    expect(mod.clearPendingCrashes).toHaveBeenCalled();
    expect(mod.pending).toHaveLength(0);
  });

  it('a launch that started disabled covers its own lifetime, from process start', async () => {
    const platform = memoryPlatform();
    const s1 = newScout({ enabled: false }, platform);
    s1.processStartedAtMs = Date.now() - 5_000;
    await s1.bootstrap();
    const s2 = await makeScout({}, platform);
    expect(
      s2.crashHappenedWhileDisabled({ 'crash.death_timestamp_ms': Date.now() - 4_000 }),
    ).toBe(true);
    expect(
      s2.crashHappenedWhileDisabled({ 'crash.death_timestamp_ms': Date.now() - 60_000 }),
    ).toBe(false);
  });

  it('a crash from an earlier enabled run is still replayed by the next enabled launch', async () => {
    const platform = memoryPlatform();
    await makeScout({}, platform);
    const s2 = await makeScout({}, platform);
    const mod = fakeCrashModule([
      {
        'crash.type': 'uncaught_exception',
        'crash.timestamp': String(Date.now() - 1000),
      },
    ]);
    await installNativeCrashReader(s2, mod);
    expect(rec.spans().filter((x) => x.name === SPAN.NATIVE_CRASH)).toHaveLength(1);
  });

  it('an enabled-run crash is kept, not dropped, while the next launch is disabled', async () => {
    const platform = memoryPlatform();
    await makeScout({}, platform);
    const crashAt = Date.now() - 1000;
    const s2 = await makeScout({ enabled: false }, platform);
    const mod = fakeCrashModule([
      { 'crash.type': 'uncaught_exception', 'crash.timestamp': String(crashAt) },
    ]);
    // Even if something drained while disabled, nothing would be emitted…
    expect(s2.crashHappenedWhileDisabled(mod.pending[0]!)).toBe(false);
    // …and once enabled the report goes out.
    await s2.setEnabled(true);
    await installNativeCrashReader(s2, mod);
    expect(rec.spans().filter((x) => x.name === SPAN.NATIVE_CRASH)).toHaveLength(1);
  });

  it('a crash after re-enabling in the same process is reported', async () => {
    const platform = memoryPlatform();
    const s = await makeScout({}, platform);
    await s.setEnabled(false);
    await s.setEnabled(true);
    expect(
      s.crashHappenedWhileDisabled({ 'crash.timestamp': String(Date.now() + 10) }),
    ).toBe(false);
  });
});

describe('DisabledPeriods', () => {
  it('closes a period a dead process left open at the next load', async () => {
    const platform = memoryPlatform();
    const a = new DisabledPeriods(platform);
    await a.load(1_000);
    await a.open(2_000);
    const b = new DisabledPeriods(platform);
    await b.load(5_000);
    expect(b.list()).toEqual([{ from: 2_000, to: 5_000 }]);
    expect(JSON.parse((await platform.getItem(DISABLED_PERIODS_KEY))!)).toEqual([
      { from: 2_000, to: 5_000 },
    ]);
    expect(b.covers(3_000)).toBe(true);
    expect(b.covers(6_000)).toBe(false);
  });

  it('writes nothing for apps that never disable', async () => {
    const platform = memoryPlatform();
    await makeScout({}, platform);
    expect(await platform.getItem(DISABLED_PERIODS_KEY)).toBeNull();
  });

  it('prunes periods older than the retention window', async () => {
    const platform = memoryPlatform();
    const day = 24 * 60 * 60 * 1000;
    await platform.setItem(
      DISABLED_PERIODS_KEY,
      JSON.stringify([
        { from: 0, to: day },
        { from: 9 * day, to: 9 * day + 1 },
      ]),
    );
    const p = new DisabledPeriods(platform);
    await p.load(10 * day);
    expect(p.list()).toEqual([{ from: 9 * day, to: 9 * day + 1 }]);
  });

  it('reads every native timestamp shape', () => {
    const iso = '2026-11-12T10:00:00.000Z';
    const ms = Date.parse(iso);
    expect(crashReportTime({ 'crash.timestamp': iso })).toEqual({ at: ms });
    expect(crashReportTime({ 'crash.timestamp': String(ms) })).toEqual({ at: ms });
    expect(crashReportTime({ 'crash.timestamp': String(ms / 1000) })).toEqual({ at: ms });
    expect(crashReportTime({ 'crash.death_timestamp_ms': ms })).toEqual({ at: ms });
    expect(
      crashReportTime({
        'crash.type': 'metric_kit_crash',
        'crash.timestamp': '2026-11-13T00:00:00Z',
        'crash.diagnostic_payload_time_begin': '2026-11-11T00:00:00Z',
        'crash.diagnostic_payload_time_end': '2026-11-12T00:00:00Z',
      }),
    ).toEqual({
      from: Date.parse('2026-11-11T00:00:00Z'),
      to: Date.parse('2026-11-12T00:00:00Z'),
    });
    expect(crashReportTime({ 'crash.type': 'x' })).toBeNull();
  });

  it('keeps a report with no usable time; drops a MetricKit window that overlaps', () => {
    const periods = { covers: () => true, overlaps: () => true };
    expect(crashHappenedWhileDisabled({ 'crash.type': 'x' }, periods)).toBe(false);
    expect(
      crashHappenedWhileDisabled(
        {
          'crash.type': 'metric_kit_hang',
          'crash.diagnostic_payload_time_begin': '2026-11-11T00:00:00Z',
          'crash.diagnostic_payload_time_end': '2026-11-12T00:00:00Z',
        },
        periods,
      ),
    ).toBe(true);
  });
});
