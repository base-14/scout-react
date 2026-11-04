// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { trace, metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';

/**
 * End-to-end check of user-based sampling through the real web SDK
 * (`Scout.initialize`, real OTLP/JSON exporters, localStorage) against a
 * production-like setup:
 *
 * - A dummy remote-config server applies per-user targeting rules and serves
 *   `scout_user_sampling` over HTTP. Rules can be re-published mid-test, like
 *   a console publish.
 * - The app-side client works like Firebase Remote Config or a flag SDK: it
 *   fetches, caches the last-fetched value in the app's own storage, and reads
 *   that cached value synchronously at the next page load.
 * - The same server is the OTLP collector, so assertions are on what the SDK
 *   actually exported over HTTP.
 */

type Rec = Record<string, string>;

// Node ≥ 25 defines its own global `localStorage` (undefined without
// --localstorage-file) that shadows jsdom's. The SDK and the app both read
// `globalThis.localStorage`, so give them a real Storage that survives page
// "reloads" (module resets), as a browser's does.
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

class DummyBackend {
  rules: Record<string, boolean> = {};
  version = 0;
  readonly spans: Rec[] = [];
  readonly logs: Rec[] = [];
  private server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/remote-config') {
      const value = this.rules[url.searchParams.get('user') ?? ''];
      const values = value === undefined ? {} : { scout_user_sampling: value };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: this.version, values }));
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const json = JSON.parse(body);
        if (url.pathname === '/v1/traces') this.spans.push(...collect(json, 'spans'));
        if (url.pathname === '/v1/logs') this.logs.push(...collect(json, 'logRecords'));
      } catch {}
      res.writeHead(200);
      res.end('{}');
    });
  });
  baseUrl = '';
  async start() {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
  publish(rules: Record<string, boolean>) {
    this.rules = rules;
    this.version++;
  }
  span(marker: string, name: string) {
    return this.spans.filter((s) => s.marker === marker && s['@name'] === name);
  }
  log(marker: string) {
    return this.logs.filter((l) => l.marker === marker);
  }
}

/** Flattens OTLP/JSON records under arrays named `key` into attribute maps (plus `@name`). */
function collect(node: unknown, key: string, out: Rec[] = []): Rec[] {
  if (Array.isArray(node)) node.forEach((n) => collect(n, key, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === key && Array.isArray(v)) {
        for (const r of v as Array<Record<string, unknown>>) {
          const m: Rec = {};
          if (typeof r.name === 'string') m['@name'] = r.name;
          for (const a of (r.attributes as Array<{
            key: string;
            value: Record<string, unknown>;
          }>) ?? []) {
            m[a.key] = String(Object.values(a.value)[0]);
          }
          out.push(m);
        }
      } else collect(v, key, out);
    }
  }
  return out;
}

/** App-side remote-config client, modelled on Firebase Remote Config: fetch, cache, read cached at startup. */
class AppRemoteConfig {
  private static KEY = 'app.rc.scout_user_sampling';
  constructor(private baseUrl: string) {}
  cachedValue(): boolean | null {
    const raw = localStorage.getItem(AppRemoteConfig.KEY);
    return raw === null ? null : raw === 'true';
  }
  async fetch(user: string): Promise<boolean | null> {
    const res = await fetch(
      `${this.baseUrl}/remote-config?user=${encodeURIComponent(user)}`,
    );
    const body = (await res.json()) as { values: { scout_user_sampling?: boolean } };
    const v = body.values.scout_user_sampling ?? null;
    if (v === null) localStorage.removeItem(AppRemoteConfig.KEY);
    else localStorage.setItem(AppRemoteConfig.KEY, String(v));
    return v;
  }
  clear() {
    localStorage.removeItem(AppRemoteConfig.KEY);
  }
}

async function until(what: string, cond: () => boolean) {
  const deadline = Date.now() + 10_000;
  // Date is faked in these tests; time the wait with the real clock.
  const realNow = () => performance.now();
  const start = realNow();
  while (realNow() - start < 10_000) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  void deadline;
  throw new Error(`timed out waiting for ${what}`);
}

describe('user-based sampling against a dummy remote-config server (web)', () => {
  const backend = new DummyBackend();
  let now = new Date('2026-11-04T10:00:00Z').getTime();

  beforeAll(async () => {
    await backend.start();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterAll(async () => {
    vi.useRealTimers();
    await backend.stop();
  });
  afterEach(() => undefined);

  async function launch(userSampling: boolean | null) {
    vi.resetModules();
    const { Scout } = await import('./index');
    await Scout.initialize({
      serviceName: 'rc-sim',
      endpoint: backend.baseUrl,
      secure: false,
      sessionSampleRate: 100, // fallback keeps everything, so any drop is the user value
      sessionTimeoutMinutes: 30,
      maxSessionDurationMinutes: 60,
      enableUncleanExitDetection: false,
      userSampling,
    } as never);
    return Scout;
  }

  async function close(Scout: { shutdown(): Promise<void> }) {
    await Scout.shutdown();
    trace.disable();
    metrics.disable();
    logs.disable();
  }

  async function activity(Scout: Awaited<ReturnType<typeof launch>>, marker: string) {
    Scout.logEvent('screen_view', { marker });
    Scout.reportError(new Error(`boom ${marker}`));
    Scout.logInfo(`log ${marker}`, { marker });
    await Scout.flush();
    // Spans and logs travel in separate requests: wait for both before any
    // "nothing exported" assertion can be trusted.
    await until(
      `${marker} log + error span`,
      () =>
        backend.log(marker).length > 0 &&
        backend.spans.some(
          (x) => x['@name'] === 'error' && x['error.message'] === `boom ${marker}`,
        ),
    );
  }

  function advance(minutes: number) {
    now += minutes * 60_000;
    vi.setSystemTime(now);
  }

  it('remote config drives per-user sessions end to end', async () => {
    backend.publish({ alice: false, bob: true });
    localStorage.clear();
    const rc = new AppRemoteConfig(backend.baseUrl);

    // ── Load 1: fresh browser, nothing cached, so no opinion. Fallback session.
    let Scout = await launch(rc.cachedValue());
    const anonSession = Scout.sessionId;
    await activity(Scout, 'anon');
    await until('anon screen', () => backend.span('anon', 'screen_view').length > 0);
    expect(backend.span('anon', 'screen_view')[0]['session.sampling_source']).toBe(
      'fallback',
    );

    // alice logs in: fetch her value, pass it on, then setUser. Anonymous → first id keeps
    // the session, so her "no" waits for the next session start.
    Scout.setUserSampling(await rc.fetch('alice'));
    Scout.setUser('alice');
    expect(Scout.sessionId).toBe(anonSession);

    // ── Next session (max duration): alice's "no" applies. Screen spans are dropped,
    // errors still pass, and logs keep flowing, tagged as user-decided.
    advance(61);
    const aliceSession = Scout.sessionId;
    expect(aliceSession).not.toBe(anonSession);
    await activity(Scout, 'alice-no');
    await until('alice-no log', () => backend.log('alice-no').length > 0);
    await until('alice-no error', () =>
      backend.spans.some(
        (s) => s['@name'] === 'error' && s['session.id'] === aliceSession,
      ),
    );
    expect(backend.span('alice-no', 'screen_view')).toHaveLength(0);
    const log = backend.log('alice-no')[0];
    expect(log['session.id']).toBe(aliceSession);
    expect(log['session.sampling_source']).toBe('user');
    expect(log['session.sampled']).toBe('false');
    await close(Scout);

    // ── Reload within the session: the app passes its cached value (false); the
    // resumed session keeps its decision.
    advance(1);
    Scout = await launch(rc.cachedValue());
    expect(Scout.sessionId).toBe(aliceSession);
    Scout.setUser('alice');

    // ── The console moves alice to "yes". A refresh delivers it mid-session: the
    // current session must not switch behaviour.
    backend.publish({ alice: true, bob: true });
    Scout.setUserSampling(await rc.fetch('alice'));
    await activity(Scout, 'alice-refresh');
    await until('alice-refresh log', () => backend.log('alice-refresh').length > 0);
    expect(backend.span('alice-refresh', 'screen_view')).toHaveLength(0);

    // ...and it applies at the next session start.
    advance(61);
    await activity(Scout, 'alice-yes');
    await until(
      'alice-yes screen',
      () => backend.span('alice-yes', 'screen_view').length > 0,
    );
    expect(backend.span('alice-yes', 'screen_view')[0]['session.sampling_source']).toBe(
      'user',
    );

    // ── Account switch alice → bob without logout. bob's value is fetched first, so
    // setUser rotates and bob never inherits alice's session.
    backend.publish({ alice: false, bob: false });
    const beforeSwitch = Scout.sessionId;
    Scout.setUserSampling(await rc.fetch('bob'));
    Scout.setUser('bob');
    expect(Scout.sessionId).not.toBe(beforeSwitch);
    await activity(Scout, 'bob-no');
    await until('bob-no log', () => backend.log('bob-no').length > 0);
    expect(backend.span('bob-no', 'screen_view')).toHaveLength(0);
    expect(backend.log('bob-no')[0]['user.id']).toBe('bob');

    // ── Logout: clearUser resets the value and rotates into a fallback session.
    const beforeLogout = Scout.sessionId;
    Scout.clearUser();
    rc.clear();
    expect(Scout.sessionId).not.toBe(beforeLogout);
    await activity(Scout, 'logged-out');
    await until(
      'logged-out screen',
      () => backend.span('logged-out', 'screen_view').length > 0,
    );
    expect(backend.span('logged-out', 'screen_view')[0]['session.sampling_source']).toBe(
      'fallback',
    );
    await close(Scout);

    // ── Next load after logout and idle: nothing stored, nothing cached, still fallback.
    advance(31);
    Scout = await launch(rc.cachedValue());
    await activity(Scout, 'reload-anon');
    await until(
      'reload-anon screen',
      () => backend.span('reload-anon', 'screen_view').length > 0,
    );
    expect(backend.span('reload-anon', 'screen_view')[0]['session.sampling_source']).toBe(
      'fallback',
    );
    await close(Scout);
  });

  it('a value set before initialize() decides the very first session', async () => {
    localStorage.clear();
    vi.resetModules();
    const { Scout } = await import('./index');
    Scout.setUserSampling(false);
    await Scout.initialize({
      serviceName: 'rc-sim',
      endpoint: backend.baseUrl,
      secure: false,
      sessionSampleRate: 100,
      enableUncleanExitDetection: false,
    } as never);
    await activity(Scout, 'pre-init');
    await until('pre-init log', () => backend.log('pre-init').length > 0);
    expect(backend.span('pre-init', 'screen_view')).toHaveLength(0);
    expect(backend.log('pre-init')[0]['session.sampling_source']).toBe('user');
    await close(Scout);
  });
});
