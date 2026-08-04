// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installCrashDetector } from './crash';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';

const MARKER_KEY = 'scout.session-marker';

async function makeScout() {
  const s = new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
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

describe('app_crash from the session marker', () => {
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
  });

  function seedCrashedSession(marker: Record<string, unknown>) {
    storage.setItem(
      MARKER_KEY,
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
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_CRASH);
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
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_CRASH);
    expect(span!.attributes[ATTR.CRASH_TIMESTAMP]).toBe('2026-01-01T00:05:00.000Z');
  });

  it('falls back to session start when an older marker has no lastActiveAt', async () => {
    // Markers written by <=0.1.11 have no lastActiveAt; the crash must still
    // be reported, dated no later than it could possibly have happened.
    seedCrashedSession({});
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_CRASH);
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
    const span = recorder.spans().find((sp) => sp.name === SPAN.APP_CRASH);
    const crumbs = JSON.parse(String(span!.attributes[ATTR.BREADCRUMBS]));
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].message).toBe('screen: /checkout');
  });

  it('emits nothing when the previous session shut down cleanly', async () => {
    seedCrashedSession({ active: false });
    const s = await makeScout();
    disposers.push(installCrashDetector(s));
    expect(recorder.spans().find((sp) => sp.name === SPAN.APP_CRASH)).toBeUndefined();
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
