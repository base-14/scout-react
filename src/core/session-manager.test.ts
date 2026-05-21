import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from './session-manager';
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
});
