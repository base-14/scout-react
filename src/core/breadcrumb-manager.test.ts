import { beforeEach, describe, expect, it } from 'vitest';
import { BreadcrumbManager } from './breadcrumb-manager';
import type { PlatformAdapter } from './platform';
function memoryPlatform(): PlatformAdapter {
  const store = new Map<string, string>();
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
describe('BreadcrumbManager', () => {
  let mgr: BreadcrumbManager;
  let platform: PlatformAdapter;
  beforeEach(() => {
    platform = memoryPlatform();
    mgr = new BreadcrumbManager(platform);
  });
  it('starts empty', () => {
    expect(mgr.list()).toEqual([]);
    expect(mgr.serialize()).toBe('[]');
  });
  it('records crumbs with type, message, and ISO timestamp', () => {
    mgr.add('tap', 'pressed Add to cart');
    const crumbs = mgr.list();
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]?.type).toBe('tap');
    expect(crumbs[0]?.message).toBe('pressed Add to cart');
    expect(crumbs[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('caps the buffer at 100 entries (FIFO eviction)', () => {
    for (let i = 0; i < 105; i++) mgr.add('navigation', `crumb-${i}`);
    const crumbs = mgr.list();
    expect(crumbs).toHaveLength(100);
    expect(crumbs[0]?.message).toBe('crumb-5');
    expect(crumbs[99]?.message).toBe('crumb-104');
  });
  it('serializes to JSON', () => {
    mgr.add('tap', 'one');
    mgr.add('navigation', 'two');
    const parsed = JSON.parse(mgr.serialize());
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('tap');
    expect(parsed[1].type).toBe('navigation');
  });
  it('hydrates the previous session’s crumbs as orphans, not into the live trail', async () => {
    // Breadcrumbs describe one session. A crash drained after restart needs
    // the crumbs of the session that died; the new session's trail must start
    // empty rather than inheriting a dead session's history.
    mgr.add('tap', 'persisted');
    await new Promise((r) => setTimeout(r, 5));
    const next = new BreadcrumbManager(platform);
    await next.hydrate();
    expect(next.list()).toEqual([]);
    const orphaned = next.orphaned();
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]?.message).toBe('persisted');
    expect(JSON.parse(next.serializeOrphaned()!)).toHaveLength(1);
  });
  it('serves the same orphans to every report describing that session', async () => {
    // Both the app_crash span and any drained native crash report belong to
    // the session that died, so reading the orphans must not consume them.
    mgr.add('tap', 'persisted');
    await new Promise((r) => setTimeout(r, 5));
    const next = new BreadcrumbManager(platform);
    await next.hydrate();
    expect(next.orphaned()).toHaveLength(1);
    expect(next.orphaned()).toHaveLength(1);
  });
  it('reports no orphans when nothing was persisted', async () => {
    const fresh = new BreadcrumbManager(memoryPlatform());
    await fresh.hydrate();
    expect(fresh.orphaned()).toEqual([]);
    expect(fresh.serializeOrphaned()).toBeNull();
  });
  it('keeps the live trail separate from the orphans', async () => {
    mgr.add('tap', 'old');
    await new Promise((r) => setTimeout(r, 5));
    const next = new BreadcrumbManager(platform);
    await next.hydrate();
    next.add('tap', 'new');
    expect(next.list().map((c) => c.message)).toEqual(['new']);
    expect(next.orphaned().map((c) => c.message)).toEqual(['old']);
  });
  it('does not re-orphan the same crumbs on a launch that adds none', async () => {
    // hydrate() overwrites the persisted copy immediately, so a launch that
    // never records a crumb cannot resurrect the previous session's trail and
    // attach it to a second crash report.
    mgr.add('tap', 'persisted');
    await new Promise((r) => setTimeout(r, 5));
    const second = new BreadcrumbManager(platform);
    await second.hydrate();
    expect(second.orphaned()).toHaveLength(1);
    const third = new BreadcrumbManager(platform);
    await third.hydrate();
    expect(third.orphaned()).toEqual([]);
  });
  it('clear() empties the buffer', () => {
    mgr.add('tap', 'one');
    mgr.add('navigation', 'two');
    mgr.clear();
    expect(mgr.list()).toEqual([]);
  });
  it('pushes the serialized trail to the native sink on each add', () => {
    const calls: string[] = [];
    mgr.setNativeSink((json) => calls.push(json));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('[]');
    mgr.add('tap', 'one');
    expect(calls).toHaveLength(2);
    const trail = JSON.parse(calls[1] ?? '[]');
    expect(trail).toHaveLength(1);
    expect(trail[0].type).toBe('tap');
  });
});
