// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installCrashDetector } from './crash';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';

const LEGACY_MARKER_KEY = 'scout.session-marker';
const MARKER_KEY = `${LEGACY_MARKER_KEY}:test-svc:`;

async function makeScout(identity: { serviceName?: string; environment?: string } = {}) {
  const s = new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
      ...identity,
    },
    memoryPlatform(),
  );
  await s.bootstrap();
  return s;
}

// Node's own experimental `localStorage` global shadows jsdom's and exposes
// no methods, so the tests supply a minimal working Storage.
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe('app_unclean_exit from the session marker', () => {
  let recorder: Recorder;
  let storage: ReturnType<typeof memoryStorage>;
  const disposers: Array<() => void> = [];
  beforeEach(() => {
    recorder = makeRecorder();
    storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => {
    disposers.splice(0).forEach((d) => d());
    vi.unstubAllGlobals();
    vi.useRealTimers();
    // Tests override the instance getter; drop it so jsdom's own applies again.
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  function seedCrashedSession(marker: Record<string, unknown>, key: string = MARKER_KEY) {
    storage.setItem(
      key,
      JSON.stringify({
        sessionId: 'dead-session',
        startedAt: '2026-01-01T00:00:00.000Z',
        lastScreen: '/checkout',
        active: true,
        ...marker,
      }),
    );
  }

  it('attributes the span to the crashed session, not the new one', async () => {
    seedCrashedSession({ lastActiveAt: '2026-01-01T00:05:00.000Z' });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT);
    expect(span).toBeDefined();
    expect(span!.attributes[ATTR.SESSION_ID]).toBe('dead-session');
    expect(span!.attributes[ATTR.SESSION_ID]).not.toBe(s.sessionId);
    expect(span!.attributes[ATTR.SESSION_START_TIME]).toBe('2026-01-01T00:00:00.000Z');
    expect(span!.attributes[ATTR.CRASH_PREVIOUS_SESSION_ID]).toBe('dead-session');
  });

  it('reports the last-known-alive time, not the detection time', async () => {
    seedCrashedSession({ lastActiveAt: '2026-01-01T00:05:00.000Z' });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT);
    expect(span!.attributes[ATTR.CRASH_TIMESTAMP]).toBe('2026-01-01T00:05:00.000Z');
  });

  it('falls back to session start when an older marker has no lastActiveAt', async () => {
    // Markers written by <=0.1.11 have no lastActiveAt; the crash must still
    // be reported, dated no later than it could possibly have happened.
    seedCrashedSession({});
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT);
    expect(span!.attributes[ATTR.CRASH_TIMESTAMP]).toBe('2026-01-01T00:00:00.000Z');
  });

  it('carries the crashed session’s breadcrumbs, not the new session’s', async () => {
    seedCrashedSession({ lastActiveAt: '2026-01-01T00:05:00.000Z' });
    const platform = memoryPlatform();
    await platform.setItem(
      'scout.breadcrumbs',
      JSON.stringify([
        {
          type: 'navigation',
          message: 'screen: /checkout',
          time: '2026-01-01T00:04:00.000Z',
        },
      ]),
    );
    const s = new Scout(
      {
        serviceName: 'test-svc',
        endpoint: 'http://localhost:4318',
        secure: false,
        sessionSampleRate: 100,
      },
      platform,
    );
    await s.bootstrap();
    s.addBreadcrumb('tap', 'a crumb from the new session');
    disposers.push(installCrashDetector(s));
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT);
    const crumbs = JSON.parse(String(span!.attributes[ATTR.BREADCRUMBS]));
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].message).toBe('screen: /checkout');
  });

  it('emits nothing when the previous session shut down cleanly', async () => {
    seedCrashedSession({ active: false });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    expect(
      recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT),
    ).toBeUndefined();
  });

  it('never emits app_crash, so a routine tab close cannot depress crash-free rate', async () => {
    seedCrashedSession({ lastActiveAt: '2026-01-01T00:05:00.000Z' });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    expect(recorder.spans().find((sp) => sp.name === SPAN.APP_CRASH)).toBeUndefined();
    expect(
      recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT),
    ).toBeDefined();
  });

  it('does not read another tenant’s marker from the same origin', async () => {
    // One host serves many tenants under different paths; before the key was
    // scoped, oteldemo2's dead tab was filed against whichever tenant loaded next.
    seedCrashedSession(
      { sessionId: 'oteldemo2-session', lastScreen: '/oteldemo2/a/base14-logx-app' },
      `${LEGACY_MARKER_KEY}:other-svc:nbg1-oteldemo2`,
    );
    const s = await makeScout({ serviceName: 'test-svc', environment: 'nbg1-axi' });
    disposers.push(installCrashDetector(s));
    expect(
      recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT),
    ).toBeUndefined();
  });

  it('reads back only its own tenant’s marker', async () => {
    seedCrashedSession(
      { sessionId: 'axi-session' },
      `${LEGACY_MARKER_KEY}:test-svc:nbg1-axi`,
    );
    const s = await makeScout({ environment: 'nbg1-axi' });
    disposers.push(installCrashDetector(s));
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT);
    expect(span!.attributes[ATTR.CRASH_PREVIOUS_SESSION_ID]).toBe('axi-session');
  });

  it('discards an unattributable legacy marker instead of guessing a tenant', async () => {
    seedCrashedSession({ sessionId: 'ambiguous' }, LEGACY_MARKER_KEY);
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    expect(
      recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT),
    ).toBeUndefined();
    expect(storage.getItem(LEGACY_MARKER_KEY)).toBeNull();
  });

  it('carries the originating identity, which resource attributes cannot restate', async () => {
    seedCrashedSession(
      {
        lastActiveAt: '2026-01-01T00:05:00.000Z',
        serviceName: 'test-svc',
        serviceVersion: '9.9.9',
        environment: 'nbg1-axi',
      },
      `${LEGACY_MARKER_KEY}:test-svc:nbg1-axi`,
    );
    const s = await makeScout({ environment: 'nbg1-axi' });
    disposers.push(installCrashDetector(s));
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT);
    expect(span!.attributes[ATTR.CRASH_SERVICE_NAME]).toBe('test-svc');
    expect(span!.attributes[ATTR.CRASH_SERVICE_VERSION]).toBe('9.9.9');
    expect(span!.attributes[ATTR.CRASH_ENVIRONMENT]).toBe('nbg1-axi');
  });

  it('reports the dead session’s screen, not the page that detected it', async () => {
    seedCrashedSession({ lastActiveAt: '2026-01-01T00:05:00.000Z' });
    const s = await makeScout();
    s.setCurrentScreen('/the-new-page');
    disposers.push(installCrashDetector(s));
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT);
    expect(span!.attributes[ATTR.SCREEN_NAME]).toBe('/checkout');
    expect(span!.attributes[ATTR.CRASH_LAST_SCREEN]).toBe('/checkout');
  });

  it('survives the current session being sampled out', async () => {
    // The marker describes a previous session; the live session's sample
    // decision has nothing to say about whether it should be reported.
    seedCrashedSession({ lastActiveAt: '2026-01-01T00:05:00.000Z' });
    const s = new Scout(
      {
        serviceName: 'test-svc',
        endpoint: 'http://localhost:4318',
        secure: false,
        sessionSampleRate: 0,
      },
      memoryPlatform(),
    );
    await s.bootstrap();
    disposers.push(installCrashDetector(s));
    expect(
      recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT),
    ).toBeDefined();
  });

  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }
  const marker = () => JSON.parse(storage.getItem(MARKER_KEY)!);

  it('records the live session’s sampling decision in the marker', async () => {
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    expect(marker().sampled).toBe(true);
  });

  it('records a sampled-out session as such', async () => {
    const s = new Scout(
      {
        serviceName: 'test-svc',
        endpoint: 'http://localhost:4318',
        secure: false,
        sessionSampleRate: 0,
      },
      memoryPlatform(),
    );
    await s.bootstrap();
    disposers.push(installCrashDetector(s));
    expect(marker().sampled).toBe(false);
  });

  it('skips a marker whose own session was sampled out', async () => {
    // The dead session exported nothing else, so a lone exit span for it
    // would be noise that also escapes sessionSampleRate (B14-2080).
    seedCrashedSession({ lastActiveAt: '2026-01-01T00:05:00.000Z', sampled: false });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    expect(
      recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT),
    ).toBeUndefined();
  });

  it('remembers which session it reported', async () => {
    seedCrashedSession({ lastActiveAt: '2026-01-01T00:05:00.000Z' });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    expect(marker().reportedSessionId).toBe('dead-session');
  });

  it('reports a terminated session at most once across resumes', async () => {
    // A session resumed inside sessionTimeoutMinutes keeps its id, so the
    // marker for the resumed page names the session already reported. A
    // second unclean exit of it must not file a second span (B14-2081).
    seedCrashedSession({
      lastActiveAt: '2026-01-01T00:05:00.000Z',
      reportedSessionId: 'dead-session',
    });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    expect(
      recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT),
    ).toBeUndefined();
    expect(marker().reportedSessionId).toBe('dead-session');
  });

  it('still reports a different session after one was already reported', async () => {
    seedCrashedSession({
      sessionId: 'next-dead-session',
      lastActiveAt: '2026-01-01T00:05:00.000Z',
      reportedSessionId: 'dead-session',
    });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_UNCLEAN_EXIT);
    expect(span!.attributes[ATTR.CRASH_PREVIOUS_SESSION_ID]).toBe('next-dead-session');
    expect(marker().reportedSessionId).toBe('next-dead-session');
  });

  it('does not re-arm the marker on the heartbeat while the page is hidden', async () => {
    // An embedded WebView keeps running timers after visibilitychange:hidden
    // and is then destroyed without pagehide; a blanket active:true heartbeat
    // turned every such close into an unclean exit (B14-2079).
    const s = await makeScout();
    vi.useFakeTimers();
    disposers.push(installCrashDetector(s));
    expect(marker().active).toBe(true);
    setVisibility('hidden');
    expect(marker().active).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(marker().active).toBe(false);
    setVisibility('visible');
    expect(marker().active).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(marker().active).toBe(true);
  });

  it('marks the page inactive on freeze and re-arms it on resume', async () => {
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    setVisibility('visible');
    document.dispatchEvent(new Event('freeze'));
    expect(marker().active).toBe(false);
    document.dispatchEvent(new Event('resume'));
    expect(marker().active).toBe(true);
  });

  it('starts inactive when the page is created hidden', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    expect(marker().active).toBe(false);
    setVisibility('visible');
    expect(marker().active).toBe(true);
  });

  it('records the live session’s own start time in the marker it writes', async () => {
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    const marker = JSON.parse(storage.getItem(MARKER_KEY)!);
    expect(marker.sessionId).toBe(s.sessionId);
    expect(marker.startedAt).toBe(s.sessionManager.startedAtIso);
    expect(marker.active).toBe(true);
    expect(typeof marker.lastActiveAt).toBe('string');
  });
});
