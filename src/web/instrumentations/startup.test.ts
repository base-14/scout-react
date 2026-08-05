// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';
import { installStartupTracker, __resetStartupStateForTests } from './startup';

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

/** `emitCold` runs in a microtask when the document is already complete. */
const settle = () => new Promise<void>((r) => queueMicrotask(() => r()));

describe('installStartupTracker', () => {
  let recorder: Recorder;
  const disposers: Array<() => void> = [];
  beforeEach(() => {
    recorder = makeRecorder();
    __resetStartupStateForTests();
    // jsdom exposes no navigation entry, which is the one input `emitCold`
    // refuses to run without.
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((type: string) =>
      type === 'navigation'
        ? ([
            {
              loadEventEnd: 1200,
              domContentLoadedEventEnd: 900,
              domComplete: 1100,
              domInteractive: 700,
              responseStart: 120,
            },
          ] as unknown as PerformanceEntryList)
        : [],
    );
  });
  afterEach(() => {
    for (const d of disposers.splice(0)) d();
    vi.restoreAllMocks();
  });

  function install(scout: Scout) {
    const d = installStartupTracker(scout);
    disposers.push(d);
    return d;
  }

  it('emits a cold app_startup span on first install', async () => {
    install(await newScout());
    await settle();
    const spans = recorder.spans().filter((s) => s.name === SPAN.APP_STARTUP);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes[ATTR.APP_STARTUP_TYPE]).toBe('cold');
  });

  // A host that mounts and unmounts the SDK (a Grafana app plugin, a
  // micro-frontend) reinstalls this tracker on every entry. The navigation
  // timing it reads belongs to the document, not to the install, so a second
  // emission would report a page load that never happened — and would report
  // it with byte-identical timings, which silently skews startup percentiles.
  it('does not re-emit a cold start when reinstalled on the same document', async () => {
    const first = install(await newScout());
    await settle();
    first();
    recorder.reset();

    install(await newScout());
    await settle();
    expect(recorder.spans().filter((s) => s.name === SPAN.APP_STARTUP)).toHaveLength(0);
  });

  it('still reports a warm start from bfcache after a reinstall', async () => {
    const first = install(await newScout());
    await settle();
    first();
    recorder.reset();

    install(await newScout());
    await settle();
    const evt = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(evt, 'persisted', { value: true });
    window.dispatchEvent(evt);

    const spans = recorder.spans().filter((s) => s.name === SPAN.APP_STARTUP);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes[ATTR.APP_STARTUP_TYPE]).toBe('warm');
  });

  it('stops reporting warm starts once disposed', async () => {
    const dispose = install(await newScout());
    await settle();
    dispose();
    recorder.reset();

    const evt = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(evt, 'persisted', { value: true });
    window.dispatchEvent(evt);
    expect(recorder.spans()).toHaveLength(0);
  });
});
