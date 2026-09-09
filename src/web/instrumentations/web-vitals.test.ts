// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metric } from 'web-vitals';
import { Scout } from '../../core/scout';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';

// `web-vitals` v5 offers no way to unsubscribe: `onCLS(cb)` registers a
// PerformanceObserver for the life of the document. These fakes stand in for
// that so a test can count registrations and fire a metric on demand.
const registered: Record<string, Array<(m: Metric) => void>> = {};
function register(name: string) {
  return (cb: (m: Metric) => void) => {
    (registered[name] ??= []).push(cb);
  };
}
vi.mock('web-vitals', () => ({
  onCLS: register('CLS'),
  onFCP: register('FCP'),
  onINP: register('INP'),
  onLCP: register('LCP'),
  onTTFB: register('TTFB'),
}));

const { installWebVitalsTracker, __resetWebVitalsStateForTests } =
  await import('./web-vitals');

function fire(name: string, value = 1.5) {
  const metric = {
    name,
    value,
    rating: 'good',
    id: `v1-${name}`,
    delta: value,
    entries: [],
    navigationType: 'navigate',
  } as unknown as Metric;
  for (const cb of registered[name] ?? []) cb(metric);
}

async function newScout(): Promise<Scout> {
  const scout = new Scout(
    {
      serviceName: 't',
      endpoint: 'http://localhost',
      secure: false,
      sessionSampleRate: 100,
    },
    memoryPlatform(),
  );
  await scout.bootstrap();
  return scout;
}

describe('installWebVitalsTracker', () => {
  let recorder: Recorder;
  const disposers: Array<() => void> = [];
  beforeEach(() => {
    recorder = makeRecorder();
    for (const k of Object.keys(registered)) delete registered[k];
    __resetWebVitalsStateForTests();
  });
  afterEach(() => {
    for (const d of disposers.splice(0)) d();
  });

  async function install() {
    const d = installWebVitalsTracker(await newScout());
    disposers.push(d);
    return d;
  }

  /** Same, but hands back the Scout so a test can inspect what it emitted. */
  async function installWithScout(): Promise<Scout> {
    const scout = await newScout();
    scout.setCurrentScreen('/checkout');
    disposers.push(installWebVitalsTracker(scout));
    return scout;
  }

  it('emits a web_vital span when a metric settles', async () => {
    await install();
    fire('LCP', 2400);
    const spans = recorder.spans().filter((s) => s.name === SPAN.WEB_VITAL);
    expect(spans).toHaveLength(1);
  });

  // Asserted as literal keys, not via ATTR.*, because these strings are the
  // wire contract the backend projects on: renaming a constant must not be
  // able to keep this green. `vital.name` in particular belongs to the mobile
  // app_vital schema — web vitals must not land in that namespace.
  it('names the core attributes under the web.vital namespace', async () => {
    await install();
    fire('LCP', 2400);

    const [span] = recorder.spans().filter((s) => s.name === SPAN.WEB_VITAL);
    expect(span.attributes).toMatchObject({
      'web.vital.name': 'LCP',
      'web.vital.value': 2400,
      'web.vital.rating': 'good',
      'web.vital.id': 'v1-LCP',
    });
    expect(Object.keys(span.attributes)).not.toContain('vital.name');
    expect(Object.keys(span.attributes)).not.toContain('vital.value');
    expect(Object.keys(span.attributes)).not.toContain('vital.rating');
    expect(Object.keys(span.attributes)).not.toContain('vital.id');
  });

  // Metric dimensions are not span attributes: otel_metrics_histogram sorts by
  // Attributes before TimeUnix, so a per-measurement dimension gives every
  // point its own never-co-located time series. These assert the histogram's
  // dimensions stay bounded even though the span above keeps the full detail.
  describe('histogram dimensions', () => {
    async function vitalPointAttributes(scout: Scout) {
      const resourceMetrics = await recorder.metrics();
      const points = resourceMetrics
        .flatMap((rm) => rm.scopeMetrics)
        .flatMap((sm) => sm.metrics)
        .filter((m) => m.descriptor.name.startsWith('web.vital.'))
        .flatMap((m) => m.dataPoints);
      expect(scout).toBeDefined();
      expect(points.length).toBeGreaterThan(0);
      return points.map((p) => p.attributes);
    }

    it('carries only bounded dimensions', async () => {
      const scout = await installWithScout();
      fire('LCP', 2400);
      for (const attrs of await vitalPointAttributes(scout)) {
        expect(Object.keys(attrs).sort()).toEqual([
          'screen.name',
          'session.id',
          'session.sample_rate',
          'session.type',
          'web.vital.name',
          'web.vital.rating',
        ]);
      }
    });

    it('drops the per-measurement id, the redundant value and the target selector', async () => {
      const scout = await installWithScout();
      fire('LCP', 2400);
      for (const attrs of await vitalPointAttributes(scout)) {
        expect(attrs).not.toHaveProperty('web.vital.id');
        expect(attrs).not.toHaveProperty('web.vital.value');
        expect(attrs).not.toHaveProperty('web.vital.target_selector');
      }
    });

    it('never writes user identity into a metric dimension', async () => {
      const scout = await installWithScout();
      scout.setUser('someone@example.com', { plan: 'pro' });
      fire('LCP', 2400);
      for (const attrs of await vitalPointAttributes(scout)) {
        expect(attrs).not.toHaveProperty('user.id');
        expect(attrs).not.toHaveProperty('user.plan');
        expect(attrs).not.toHaveProperty('user.anonymous_id');
        expect(Object.keys(attrs).some((k) => k.startsWith('user.'))).toBe(false);
      }
    });

    it('keeps session.id, which the screen web-vitals dashboards filter on', async () => {
      const scout = await installWithScout();
      fire('LCP', 2400);
      for (const attrs of await vitalPointAttributes(scout)) {
        expect(attrs['session.id']).toBe(scout.sessionId);
      }
    });

    it('keeps user identity on the span, where correlation belongs', async () => {
      const scout = await installWithScout();
      scout.setUser('someone@example.com');
      fire('LCP', 2400);
      const [span] = recorder.spans().filter((s) => s.name === SPAN.WEB_VITAL);
      expect(span.attributes['user.id']).toBe('someone@example.com');
    });
  });

  // The observers cannot be torn down, so reinstalling must reuse the existing
  // registration rather than stacking another one. Without this, a host that
  // mounts the SDK n times reports every subsequent vital n times over.
  it('registers its observers once per document, however often it is installed', async () => {
    await install();
    await install();
    await install();
    expect(registered.CLS).toHaveLength(1);
    expect(registered.LCP).toHaveLength(1);
  });

  it('reports a vital exactly once after repeated installs', async () => {
    const first = await install();
    first();
    await install();
    recorder.reset();

    fire('CLS', 0.05);
    expect(recorder.spans().filter((s) => s.name === SPAN.WEB_VITAL)).toHaveLength(1);
  });

  // The whole point of scoping the SDK to a host's lifetime: once disposed,
  // a vital that settles later must not reach a shut-down provider.
  it('stops emitting once disposed', async () => {
    const dispose = await install();
    dispose();
    recorder.reset();

    fire('INP', 180);
    expect(recorder.spans()).toHaveLength(0);
  });

  it('routes vitals to the most recent instance after a reinstall', async () => {
    const first = await install();
    first();
    recorder.reset();
    await install();

    fire('TTFB', 120);
    expect(recorder.spans().filter((s) => s.name === SPAN.WEB_VITAL)).toHaveLength(1);
  });
});
