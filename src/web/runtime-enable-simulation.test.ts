// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { trace, metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';

/**
 * End-to-end check of the runtime kill switch (`enabled` / `Scout.setEnabled`)
 * through the real web SDK (`Scout.initialize`, real OTLP/JSON exporters,
 * localStorage) against a local dummy collector that records every request it
 * receives, on any path.
 *
 * The app owns a work-hours schedule, as the motivating customer does: it
 * initialises with `enabled: isWithinShiftWindow()` and flips the switch when
 * the window opens or closes. While disabled the collector must see zero
 * requests, with export intervals short enough that any periodic export
 * (metric reader, span/log batchers) would have fired many times.
 */

type Rec = Record<string, string>;

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

class DummyCollector {
  /** Every request, whatever its path: the "no OTLP request at all" assertion counts these. */
  requests = 0;
  readonly spans: Rec[] = [];
  readonly logs: Rec[] = [];
  private server = http.createServer((req, res) => {
    this.requests++;
    const url = new URL(req.url ?? '/', 'http://x');
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
  span(marker: string, name: string) {
    return this.spans.filter((s) => s.marker === marker && s['@name'] === name);
  }
  log(marker: string) {
    return this.logs.filter((l) => l.marker === marker);
  }
  errorFor(marker: string) {
    return this.spans.filter(
      (s) => s['@name'] === 'error' && s['error.message'] === `boom ${marker}`,
    );
  }
}

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

async function until(what: string, cond: () => boolean) {
  const start = performance.now();
  while (performance.now() - start < 10_000) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The app's own schedule, cached from its backend: is an expert's shift (minus 1h lead) open? */
class ShiftSchedule {
  open = false;
  isWithinShiftWindow() {
    return this.open;
  }
}

describe('runtime kill switch against a dummy OTLP collector (web)', () => {
  const collector = new DummyCollector();
  const schedule = new ShiftSchedule();

  beforeAll(async () => {
    await collector.start();
  });
  afterAll(async () => {
    await collector.stop();
  });

  const fastExport = () => ({
    serviceName: 'kill-switch-sim',
    endpoint: collector.baseUrl,
    secure: false,
    sessionSampleRate: 100,
    enableUncleanExitDetection: false,
    // Short enough that a periodic export would fire repeatedly in the
    // quiet windows below.
    traceExportIntervalMs: 50,
    logExportScheduledDelayMs: 50,
    metricExportIntervalMs: 50,
  });

  async function load(config: Record<string, unknown>, before?: (S: any) => void) {
    // A fresh module graph per page load, with storage surviving like a browser's.
    vi.resetModules();
    const { Scout } = await import('./index');
    before?.(Scout);
    await Scout.initialize({ ...fastExport(), ...config } as never);
    return Scout;
  }

  async function close(Scout: { shutdown(): Promise<void> }) {
    await Scout.shutdown();
    trace.disable();
    metrics.disable();
    logs.disable();
  }

  function activity(Scout: any, marker: string) {
    Scout.logEvent('screen_view', { marker });
    Scout.reportError(new Error(`boom ${marker}`));
    Scout.logInfo(`log ${marker}`, { marker });
    Scout.logError(`err ${marker}`, { marker });
    Scout.startVital('vital');
    Scout.endVital('vital');
    Scout.instance?.emitGauge('kill_switch.gauge', 1);
    Scout.instance?.emitHistogram('kill_switch.histogram', 1);
  }

  /** Activity, a flush, and a quiet period several export intervals long: nothing may arrive. */
  async function expectSilence(Scout: any, marker: string) {
    const before = collector.requests;
    activity(Scout, marker);
    await Scout.flush();
    await sleep(400);
    expect(collector.requests).toBe(before);
    expect(collector.span(marker, 'screen_view')).toHaveLength(0);
    expect(collector.errorFor(marker)).toHaveLength(0);
    expect(collector.log(marker)).toHaveLength(0);
  }

  it('a schedule-driven app sends nothing outside the shift window', async () => {
    localStorage.clear();

    // ── Off-hours wake (a WorkManager job loads the full bundle): init disabled.
    schedule.open = false;
    let Scout = await load({ enabled: schedule.isWithinShiftWindow() });
    expect(Scout.enabled).toBe(false);
    expect(Scout.sessionId).toBeNull();
    expect(collector.requests).toBe(0);
    await expectSilence(Scout, 'off-hours');
    expect(collector.requests).toBe(0);
    expect(localStorage.getItem('scout.session')).toBeNull();
    // Nothing parked for later either.
    const keys = [...Array(localStorage.length)].map((_, i) => localStorage.key(i));
    expect(keys.some((k) => k?.startsWith('scout.offline.'))).toBe(false);

    // ── Window opens in the same process: a fresh session, and data flows.
    schedule.open = true;
    await Scout.setEnabled(schedule.isWithinShiftWindow());
    expect(Scout.enabled).toBe(true);
    const shiftSession = Scout.sessionId;
    expect(shiftSession).toBeTruthy();
    activity(Scout, 'shift');
    await Scout.flush();
    await until(
      'shift screen + log + error',
      () =>
        collector.span('shift', 'screen_view').length > 0 &&
        collector.log('shift').length > 0 &&
        collector.errorFor('shift').length > 0,
    );
    expect(collector.span('shift', 'screen_view')[0]!['session.id']).toBe(shiftSession);

    // ── Re-asserting the current state changes nothing.
    await Scout.setEnabled(true);
    expect(Scout.sessionId).toBe(shiftSession);

    // ── Window closes: what was recorded just before is still flushed…
    Scout.logEvent('screen_view', { marker: 'last-before-off' });
    await Scout.setEnabled(false);
    await until(
      'pre-disable span flushed',
      () => collector.span('last-before-off', 'screen_view').length > 0,
    );
    expect(Scout.sessionId).toBeNull();
    expect(localStorage.getItem('scout.session')).toBeNull();
    // …and from then on nothing at all leaves the page.
    await expectSilence(Scout, 'after-off');
    await close(Scout);

    // ── Next wake is off-hours again: still nothing.
    schedule.open = false;
    const beforeReload = collector.requests;
    Scout = await load({ enabled: schedule.isWithinShiftWindow() });
    await expectSilence(Scout, 'reload-off');
    expect(collector.requests).toBe(beforeReload);

    // ── Back on: a fresh session again, never the one that ended.
    await Scout.setEnabled(true);
    expect(Scout.sessionId).toBeTruthy();
    expect(Scout.sessionId).not.toBe(shiftSession);
    activity(Scout, 'shift-2');
    await Scout.flush();
    await until(
      'shift-2 screen',
      () => collector.span('shift-2', 'screen_view').length > 0,
    );
    await close(Scout);
  });

  it('a setEnabled(false) made before initialize() wins over enabled: true', async () => {
    localStorage.clear();
    const before = collector.requests;
    const Scout = await load({ enabled: true }, (S) => {
      S.setEnabled(false);
      expect(S.enabled).toBe(false);
    });
    expect(Scout.enabled).toBe(false);
    expect(Scout.sessionId).toBeNull();
    await expectSilence(Scout, 'pre-init-off');
    expect(collector.requests).toBe(before);
    await close(Scout);
  });
});
