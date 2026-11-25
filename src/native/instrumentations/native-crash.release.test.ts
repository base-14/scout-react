import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { createReleaseTracers } from '../../core/release-tracers';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';
import { buildOfflineWiring } from '../../core/offline-wiring';
import { EXIT_SPAN_KEY, installNativeCrashReader } from './native-crash';

type Report = Record<string, unknown>;

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

// What src/native/index.ts builds for a running 1.0.0 (build 1).
const RUNNING = {
  'service.name': 'test-svc',
  'service.version': '1.0.0+1',
  [ATTR.APP_VERSION]: '1.0.0',
  [ATTR.APP_BUILD]: '1',
  [ATTR.APP_BUNDLE_ID]: 'com.example.app',
  'os.name': 'iOS',
};

async function makeScout(overrides: Record<string, unknown> = {}) {
  const s = new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
      ...overrides,
    } as never,
    memoryPlatform(),
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

function metricKitCrash(version?: string, build?: string): Report {
  const now = Date.now();
  const r: Report = {
    'crash.type': 'metric_kit_crash',
    'crash.timestamp': iso(now),
    'crash.diagnostic_payload_time_begin': iso(now - 30 * HOUR),
    'crash.diagnostic_payload_time_end': iso(now - 26 * HOUR),
    'crash.signal': '6',
    'crash.exception_type': '10',
    'crash.stack_trace': 'e30=',
  };
  if (version !== undefined) {
    r['crash.application_version'] = version;
    r['crash.app_version'] = version;
  }
  if (build !== undefined) r['crash.application_build_version'] = build;
  return r;
}

describe('crash replayed under the release that crashed', () => {
  let rec: Recorder;
  const resource = resourceFromAttributes(RUNNING);
  beforeEach(() => {
    rec = makeRecorder({ resource });
  });

  async function scoutWithReleases(overrides: Record<string, unknown> = {}) {
    const s = await makeScout(overrides);
    s.useReleaseTracers(createReleaseTracers(resource, rec.spanProcessors));
    return s;
  }
  const crashSpans = () => rec.spans().filter((x) => x.name === SPAN.NATIVE_CRASH);
  const res = (x: ReadableSpan) => x.resource.attributes;

  it('an older-version crash carries its own release labels', async () => {
    const s = await scoutWithReleases();
    await installNativeCrashReader(s, fakeCrashModule([metricKitCrash('0.9.0', '0')]));
    const [span] = crashSpans();
    expect(span).toBeDefined();
    expect(res(span!)['service.version']).toBe('0.9.0+0');
    expect(res(span!)[ATTR.APP_VERSION]).toBe('0.9.0');
    expect(res(span!)[ATTR.APP_BUILD]).toBe('0');
    // Everything else stays as the running app's resource.
    expect(res(span!)['service.name']).toBe('test-svc');
    expect(res(span!)[ATTR.APP_BUNDLE_ID]).toBe('com.example.app');
    expect(res(span!)['os.name']).toBe('iOS');
  });

  it('the version falls back to crash.application_version', async () => {
    const s = await scoutWithReleases();
    const report = metricKitCrash('0.9.0', '0');
    delete report['crash.app_version'];
    await installNativeCrashReader(s, fakeCrashModule([report]));
    expect(res(crashSpans()[0]!)['service.version']).toBe('0.9.0+0');
  });

  it('same build, different build number, is a different release', async () => {
    const s = await scoutWithReleases();
    await installNativeCrashReader(s, fakeCrashModule([metricKitCrash('1.0.0', '0')]));
    expect(res(crashSpans()[0]!)['service.version']).toBe('1.0.0+0');
  });

  it('a crash in the running release is unchanged', async () => {
    const s = await scoutWithReleases();
    await installNativeCrashReader(s, fakeCrashModule([metricKitCrash('1.0.0', '1')]));
    const [span] = crashSpans();
    expect(res(span!)).toEqual(RUNNING);
  });

  it('a crash without a build keeps the running release', async () => {
    const s = await scoutWithReleases();
    await installNativeCrashReader(s, fakeCrashModule([metricKitCrash('0.9.0')]));
    expect(res(crashSpans()[0]!)).toEqual(RUNNING);
  });

  it('a crash without a version keeps the running release', async () => {
    const s = await scoutWithReleases();
    await installNativeCrashReader(
      s,
      fakeCrashModule([metricKitCrash(undefined, '0'), metricKitCrash('', '0')]),
    );
    expect(crashSpans()).toHaveLength(2);
    for (const span of crashSpans()) expect(res(span)).toEqual(RUNNING);
  });

  it('an explicit config.serviceVersion keeps the running release', async () => {
    const s = await scoutWithReleases({ serviceVersion: '7.0.0' });
    await installNativeCrashReader(s, fakeCrashModule([metricKitCrash('0.9.0', '0')]));
    expect(res(crashSpans()[0]!)).toEqual(RUNNING);
  });

  it('applies to app_exit spans too', async () => {
    const s = await scoutWithReleases();
    await installNativeCrashReader(
      s,
      fakeCrashModule([
        {
          'crash.type': 'low_memory',
          'crash.timestamp': iso(Date.now() - HOUR),
          'crash.app_version': '0.9.0',
          'crash.application_build_version': '0',
          [EXIT_SPAN_KEY]: SPAN.APP_EXIT,
        },
      ]),
    );
    const [span] = rec.spans().filter((x) => x.name === SPAN.APP_EXIT);
    expect(res(span!)['service.version']).toBe('0.9.0+0');
  });

  it('other spans keep the running release', async () => {
    const s = await scoutWithReleases();
    await installNativeCrashReader(s, fakeCrashModule([metricKitCrash('0.9.0', '0')]));
    s.emitSpan('screen_view', s.commonAttributes());
    s.reportError(new Error('later'));
    const others = rec.spans().filter((x) => x.name !== SPAN.NATIVE_CRASH);
    expect(others.length).toBeGreaterThan(0);
    for (const span of others) expect(res(span)).toEqual(RUNNING);
  });

  it('many crashes from one release share a provider', async () => {
    const s = await scoutWithReleases();
    await installNativeCrashReader(
      s,
      fakeCrashModule([
        metricKitCrash('0.9.0', '0'),
        metricKitCrash('0.9.0', '0'),
        metricKitCrash('0.8.0', '3'),
      ]),
    );
    const versions = crashSpans().map((x) => res(x)['service.version']);
    expect(versions.sort()).toEqual(['0.8.0+3', '0.9.0+0', '0.9.0+0']);
    const [a, b] = crashSpans().filter((x) => res(x)['service.version'] === '0.9.0+0');
    expect(a!.resource).toBe(b!.resource);
  });

  it('the kill switch still drops it', async () => {
    const s = await scoutWithReleases();
    await s.setEnabled(false);
    rec.reset();
    await installNativeCrashReader(s, fakeCrashModule([metricKitCrash('0.9.0', '0')]));
    expect(crashSpans()).toHaveLength(0);
  });

  it('beforeSend still applies', async () => {
    const s = await scoutWithReleases({
      beforeSend: (e: { name: string; [k: string]: unknown }) =>
        e.name === SPAN.NATIVE_CRASH ? { ...e, 'crash.reason': 'redacted' } : e,
    });
    await installNativeCrashReader(s, fakeCrashModule([metricKitCrash('0.9.0', '0')]));
    const [span] = crashSpans();
    expect(span!.attributes[ATTR.CRASH_REASON]).toBe('redacted');
    expect(res(span!)['service.version']).toBe('0.9.0+0');

    const dropping = await scoutWithReleases({
      beforeSend: (e: { name: string }) => (e.name === SPAN.NATIVE_CRASH ? null : e),
    });
    rec.reset();
    await installNativeCrashReader(
      dropping,
      fakeCrashModule([metricKitCrash('0.9.0', '0')]),
    );
    expect(crashSpans()).toHaveLength(0);
  });

  it('starts as a root span, not inside the running launch trace', async () => {
    const s = await scoutWithReleases();
    s.setRootSpan(s.startRootSpan('app_start'), { endPrevious: false });
    await installNativeCrashReader(
      s,
      fakeCrashModule([metricKitCrash('0.9.0', '0'), metricKitCrash('1.0.0', '1')]),
    );
    const [older, current] = [...crashSpans()].sort((a, b) =>
      String(res(a)['service.version']).localeCompare(String(res(b)['service.version'])),
    );
    expect(res(older!)['service.version']).toBe('0.9.0+0');
    expect(older!.parentSpanContext).toBeUndefined();
    // The running release's crash keeps today's parent.
    expect(res(current!)['service.version']).toBe('1.0.0+1');
    expect(current!.parentSpanContext).toBeDefined();
  });

  it('ignores surrounding whitespace in the crash version and build', async () => {
    const s = await scoutWithReleases();
    await installNativeCrashReader(
      s,
      fakeCrashModule([metricKitCrash(' 1.0.0 ', ' 1 ')]),
    );
    expect(res(crashSpans()[0]!)['service.version']).toBe('1.0.0+1');
  });

  it("keeps each span's release through the retry and offline buffer path", async () => {
    const s = await scoutWithReleases();
    s.emitSpan('screen_load', {});
    await installNativeCrashReader(s, fakeCrashModule([metricKitCrash('0.9.0', '0')]));
    const store = new Map<string, string>();
    const storage = {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => void store.set(k, v),
      removeItem: async (k: string) => void store.delete(k),
    };
    const wiring = buildOfflineWiring(storage, 'http://localhost:4318', {
      enabled: true,
      maxItems: 100,
    } as never);
    // One failed batch with spans from both releases.
    wiring.hooks.traces.onFailedAfterRetries!(rec.spans());
    await vi.waitFor(() => expect(store.size).toBeGreaterThan(0));
    const [raw] = [...store.values()];
    const payload = JSON.parse(JSON.parse(raw!)[0].payload);
    const versions = payload.resourceSpans.map(
      (r: {
        resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
      }) =>
        r.resource.attributes.find((a) => a.key === 'service.version')!.value.stringValue,
    );
    expect(versions.sort()).toEqual(['0.9.0+0', '1.0.0+1']);
  });
});

describe('running app without a build number', () => {
  let rec: Recorder;
  const resource = resourceFromAttributes({
    'service.name': 'test-svc',
    'service.version': '1.0.0',
    [ATTR.APP_VERSION]: '1.0.0',
  });
  beforeEach(() => {
    rec = makeRecorder({ resource });
  });

  it('never relabels: the running release cannot be compared reliably', async () => {
    const s = await makeScout();
    s.useReleaseTracers(createReleaseTracers(resource, rec.spanProcessors));
    await installNativeCrashReader(
      s,
      fakeCrashModule([metricKitCrash('1.0.0', '1'), metricKitCrash('0.9.0', '0')]),
    );
    const versions = rec
      .spans()
      .filter((x) => x.name === SPAN.NATIVE_CRASH)
      .map((x) => x.resource.attributes['service.version']);
    expect(versions).toEqual(['1.0.0', '1.0.0']);
  });
});
