import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager, sessionAt } from './session-manager';
import type { PlatformAdapter } from './platform';
function memoryPlatform(seed?: Record<string, string>): PlatformAdapter {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    name: 'web',
    async getItem(k) {
      return store.get(k) ?? null;
    },
    async setItem(k, v) {
      store.set(k, v);
    },
    async removeItem(k) {
      store.delete(k);
    },
    async collectResourceAttributes() {
      return {};
    },
    getConnectionType() {
      return 'unknown';
    },
  };
}
describe('SessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('creates a new session id on first start()', async () => {
    const mgr = new SessionManager(memoryPlatform(), {
      timeoutMinutes: 30,
      sampleRate: 100,
    });
    await mgr.start();
    expect(mgr.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
  it('reuses a recent session', async () => {
    const platform = memoryPlatform();
    const a = new SessionManager(platform, { timeoutMinutes: 30, sampleRate: 100 });
    await a.start();
    const firstId = a.sessionId;
    const b = new SessionManager(platform, { timeoutMinutes: 30, sampleRate: 100 });
    await b.start();
    expect(b.sessionId).toBe(firstId);
  });
  it('rotates after the inactivity window', async () => {
    const platform = memoryPlatform();
    const a = new SessionManager(platform, { timeoutMinutes: 30, sampleRate: 100 });
    await a.start();
    const firstId = a.sessionId;
    vi.setSystemTime(new Date('2026-01-01T00:31:00Z'));
    const b = new SessionManager(platform, { timeoutMinutes: 30, sampleRate: 100 });
    await b.start();
    expect(b.sessionId).not.toBe(firstId);
  });
  it('respects sampleRate=0 (no sampling)', async () => {
    const mgr = new SessionManager(memoryPlatform(), {
      timeoutMinutes: 30,
      sampleRate: 0,
    });
    await mgr.start();
    expect(mgr.isSampled).toBe(false);
  });
  it('respects sampleRate=100 (always sampled)', async () => {
    const mgr = new SessionManager(memoryPlatform(), {
      timeoutMinutes: 30,
      sampleRate: 100,
    });
    await mgr.start();
    expect(mgr.isSampled).toBe(true);
  });
  it('rotate() produces a fresh id', async () => {
    const mgr = new SessionManager(memoryPlatform(), {
      timeoutMinutes: 30,
      sampleRate: 100,
    });
    await mgr.start();
    const before = mgr.sessionId;
    const next = await mgr.rotate();
    expect(next).not.toBe(before);
    expect(mgr.sessionId).toBe(next);
  });
  it('maybeRotateOnResume rotates after idle past timeout', async () => {
    const mgr = new SessionManager(memoryPlatform(), {
      timeoutMinutes: 30,
      sampleRate: 100,
    });
    await mgr.start();
    const before = mgr.sessionId;
    vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
    const rotated = await mgr.maybeRotateOnResume();
    expect(rotated).toBe(true);
    expect(mgr.sessionId).not.toBe(before);
  });
  it('maybeRotateOnResume preserves session within timeout', async () => {
    const mgr = new SessionManager(memoryPlatform(), {
      timeoutMinutes: 30,
      sampleRate: 100,
    });
    await mgr.start();
    const before = mgr.sessionId;
    vi.setSystemTime(new Date('2026-01-01T00:10:00Z'));
    const rotated = await mgr.maybeRotateOnResume();
    expect(rotated).toBe(false);
    expect(mgr.sessionId).toBe(before);
  });
  it('rotates on sessionId read after maxDurationMinutes lifetime', async () => {
    const mgr = new SessionManager(memoryPlatform(), {
      timeoutMinutes: 30,
      sampleRate: 100,
      maxDurationMinutes: 60,
    });
    await mgr.start();
    const before = mgr.sessionId;
    vi.setSystemTime(new Date('2026-01-01T01:01:00Z'));
    const after = mgr.sessionId;
    expect(after).not.toBe(before);
  });
  it('maxDurationMinutes=0 disables the lifetime cap', async () => {
    const mgr = new SessionManager(memoryPlatform(), {
      timeoutMinutes: 30,
      sampleRate: 100,
      maxDurationMinutes: 0,
    });
    await mgr.start();
    const before = mgr.sessionId;
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    expect(mgr.sessionId).toBe(before);
  });
  it('rotate() resets startedAt so a fresh session lives the full lifetime', async () => {
    const mgr = new SessionManager(memoryPlatform(), {
      timeoutMinutes: 30,
      sampleRate: 100,
      maxDurationMinutes: 60,
    });
    await mgr.start();
    vi.setSystemTime(new Date('2026-01-01T00:30:00Z'));
    const rotated = await mgr.rotate();
    vi.setSystemTime(new Date('2026-01-01T01:20:00Z'));
    expect(mgr.sessionId).toBe(rotated);
    vi.setSystemTime(new Date('2026-01-01T01:31:00Z'));
    expect(mgr.sessionId).not.toBe(rotated);
  });
  it('start() rotates a persisted session that exceeded maxDurationMinutes', async () => {
    const platform = memoryPlatform();
    const a = new SessionManager(platform, {
      timeoutMinutes: 30,
      sampleRate: 100,
      maxDurationMinutes: 60,
    });
    await a.start();
    const firstId = a.sessionId;
    vi.setSystemTime(new Date('2026-01-01T01:05:00Z'));
    const b = new SessionManager(platform, {
      timeoutMinutes: 30,
      sampleRate: 100,
      maxDurationMinutes: 60,
    });
    await b.start();
    expect(b.sessionId).not.toBe(firstId);
  });
});

describe('session history', () => {
  const MIN = 60_000;
  const T0 = Date.parse('2026-01-01T00:00:00Z');
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const make = (platform = memoryPlatform()) =>
    new SessionManager(platform, { timeoutMinutes: 30, sampleRate: 100 });

  it('finds the session that was running at a past time', async () => {
    const mgr = make();
    await mgr.start();
    const first = mgr.sessionId;
    vi.setSystemTime(new Date(T0 + 10 * MIN));
    mgr.touch();
    vi.setSystemTime(new Date(T0 + 3 * 60 * MIN));
    await mgr.rotate();
    expect((await mgr.sessionAt(T0 + 5 * MIN))?.id).toBe(first);
    expect((await mgr.sessionAt(T0 + 3 * 60 * MIN))?.id).toBe(mgr.sessionId);
  });

  it('finds nothing for a time no recorded session covers', async () => {
    const mgr = make();
    await mgr.start();
    vi.setSystemTime(new Date(T0 + 3 * 60 * MIN));
    await mgr.rotate();
    expect(await mgr.sessionAt(T0 - 60 * MIN)).toBeNull();
    // The first session was last active at T0; an hour later it wasn't running.
    expect(await mgr.sessionAt(T0 + 60 * MIN)).toBeNull();
  });

  it('is read back by a later launch', async () => {
    const platform = memoryPlatform();
    const a = make(platform);
    await a.start();
    const first = a.sessionId;
    vi.setSystemTime(new Date(T0 + 3 * 60 * MIN));
    const b = make(platform);
    await b.start();
    expect(b.sessionId).not.toBe(first);
    expect((await b.sessionAt(T0 + MIN))?.id).toBe(first);
  });

  it('records activity at most once a minute', async () => {
    const platform = memoryPlatform();
    const writes = vi.spyOn(platform, 'setItem');
    const mgr = make(platform);
    await mgr.start();
    const historyWrites = () =>
      writes.mock.calls.filter(([k]) => k === 'scout.session.history').length;
    const afterStart = historyWrites();
    for (let i = 1; i <= 10; i++) {
      vi.setSystemTime(new Date(T0 + i * 1000));
      mgr.touch();
    }
    await vi.runAllTimersAsync();
    expect(historyWrites()).toBe(afterStart);
    vi.setSystemTime(new Date(T0 + 2 * MIN));
    mgr.touch();
    await vi.runAllTimersAsync();
    expect(historyWrites()).toBe(afterStart + 1);
  });
});

describe('sessionAt', () => {
  const MIN = 60_000;
  it('picks the latest session started by then', () => {
    const history = [
      { id: 'a', s: 0, e: 100 * MIN },
      { id: 'b', s: 50 * MIN, e: 100 * MIN },
    ];
    expect(sessionAt(history, 60 * MIN)?.id).toBe('b');
    expect(sessionAt(history, 10 * MIN)?.id).toBe('a');
  });

  it('allows a window start rounded down to the minute', () => {
    // Started 30 s into the minute the window starts at.
    expect(sessionAt([{ id: 'a', s: 30_000, e: 5 * MIN }], 0)?.id).toBe('a');
  });
});
