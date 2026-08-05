// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';
import { installNetworkTracker } from './network';
describe('installNetworkTracker — fetch', () => {
  let recorder: Recorder;
  let scout: Scout;
  let dispose: () => void;
  let originalFetch: typeof fetch;
  beforeEach(async () => {
    recorder = makeRecorder();
    scout = new Scout(
      {
        serviceName: 't',
        endpoint: 'http://collector.example:4318',
        secure: false,
        sessionSampleRate: 100,
        firstPartyHosts: ['api.acme.com', '*.subs.acme.com', /^api\d+\.regex\.com$/],
      },
      memoryPlatform(),
    );
    await scout.bootstrap();
    originalFetch = globalThis.fetch;
    dispose = installNetworkTracker(scout);
  });
  afterEach(() => {
    dispose();
    globalThis.fetch = originalFetch;
  });
  it('emits an http.request span carrying method, url, status, duration', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('ok', { status: 200, headers: { 'content-length': '2' } }),
    );
    installNetworkTracker(scout);
    await fetch('https://api.acme.com/users', { method: 'POST' });
    const span = recorder.spans().find((s) => s.name === SPAN.HTTP_REQUEST);
    expect(span?.attributes[ATTR.HTTP_METHOD]).toBe('POST');
    expect(span?.attributes[ATTR.HTTP_URL]).toBe('https://api.acme.com/users');
    expect(span?.attributes[ATTR.HTTP_STATUS_CODE]).toBe(200);
    expect(span?.attributes[ATTR.HTTP_RESPONSE_CONTENT_LENGTH]).toBe(2);
    expect(typeof span?.attributes[ATTR.HTTP_DURATION_MS]).toBe('number');
  });
  it('injects a traceparent header for first-party hosts (exact match)', async () => {
    let captured: Headers | undefined;
    globalThis.fetch = vi.fn(async (_input, init) => {
      captured = new Headers(init?.headers ?? {});
      return new Response(null, { status: 204 });
    });
    installNetworkTracker(scout);
    await fetch('https://api.acme.com/x');
    const tp = captured?.get('traceparent');
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
  it('traceparent uses the http.request span trace id (proper distributed trace)', async () => {
    let captured: Headers | undefined;
    globalThis.fetch = vi.fn(async (_input, init) => {
      captured = new Headers(init?.headers ?? {});
      return new Response(null, { status: 200 });
    });
    installNetworkTracker(scout);
    await fetch('https://api.acme.com/x');
    const span = recorder.spans().find((s) => s.name === SPAN.HTTP_REQUEST);
    const tp = captured?.get('traceparent') ?? '';
    const [, traceId] = tp.split('-');
    expect(traceId).toBe(span?.spanContext().traceId);
  });
  it('matches *.subs.acme.com wildcard correctly', async () => {
    let captured: Headers | undefined;
    globalThis.fetch = vi.fn(async (_input, init) => {
      captured = new Headers(init?.headers ?? {});
      return new Response(null, { status: 200 });
    });
    installNetworkTracker(scout);
    await fetch('https://api.subs.acme.com/x');
    expect(captured?.get('traceparent')).toMatch(/^00-/);
  });
  it('matches a regex pattern correctly', async () => {
    let captured: Headers | undefined;
    globalThis.fetch = vi.fn(async (_input, init) => {
      captured = new Headers(init?.headers ?? {});
      return new Response(null, { status: 200 });
    });
    installNetworkTracker(scout);
    await fetch('https://api42.regex.com/x');
    expect(captured?.get('traceparent')).toMatch(/^00-/);
  });
  it('does NOT inject traceparent on third-party hosts', async () => {
    let captured: Headers | undefined;
    globalThis.fetch = vi.fn(async (_input, init) => {
      captured = new Headers(init?.headers ?? {});
      return new Response(null, { status: 200 });
    });
    installNetworkTracker(scout);
    await fetch('https://fonts.googleapis.com/x');
    expect(captured?.get('traceparent')).toBeNull();
    expect(recorder.spans().some((s) => s.name === SPAN.HTTP_REQUEST)).toBe(true);
  });
  it('skips its own collector endpoint to avoid recursion', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 }));
    installNetworkTracker(scout);
    await fetch('http://collector.example:4318/v1/traces', { method: 'POST' });
    expect(recorder.spans().some((s) => s.name === SPAN.HTTP_REQUEST)).toBe(false);
  });
  it('records http.error and ERROR status on a failed fetch', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('network');
    });
    installNetworkTracker(scout);
    await expect(fetch('https://api.acme.com/oops')).rejects.toThrow('network');
    const span = recorder.spans().find((s) => s.name === SPAN.HTTP_REQUEST);
    expect(span?.attributes[ATTR.HTTP_ERROR]).toBe('network');
    expect(span?.status.code).toBe(2);
  });
  it('marks 4xx/5xx responses as ERROR status but still records them', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 503 }));
    installNetworkTracker(scout);
    await fetch('https://api.acme.com/down');
    const span = recorder.spans().find((s) => s.name === SPAN.HTTP_REQUEST);
    expect(span?.attributes[ATTR.HTTP_STATUS_CODE]).toBe(503);
    expect(span?.status.code).toBe(2);
  });
});

/**
 * Stands in for jsdom's XMLHttpRequest, which would attempt a real request.
 * Only the surface `installNetworkTracker` patches is modelled; `dispatch`
 * lets a test drive the loadend/error/timeout/abort lifecycle by hand.
 */
class FakeXHR {
  status = 0;
  sentBody: unknown = undefined;
  readonly headers: Record<string, string> = {};
  private readonly listeners: Record<string, Array<() => void>> = {};
  open(_method: string, _url: string | URL): void {}
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body?: unknown): void {
    this.sentBody = body;
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

describe('installNetworkTracker — XMLHttpRequest', () => {
  let recorder: Recorder;
  let scout: Scout;
  let dispose: () => void;
  let originalXHR: typeof XMLHttpRequest;
  beforeEach(async () => {
    recorder = makeRecorder();
    scout = new Scout(
      {
        serviceName: 't',
        endpoint: 'http://collector.example:4318',
        secure: false,
        sessionSampleRate: 100,
        firstPartyHosts: ['api.acme.com'],
      },
      memoryPlatform(),
    );
    await scout.bootstrap();
    originalXHR = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
    dispose = installNetworkTracker(scout);
  });
  afterEach(() => {
    dispose();
    globalThis.XMLHttpRequest = originalXHR;
  });
  function request(url: string, method = 'GET'): FakeXHR {
    const xhr = new globalThis.XMLHttpRequest() as unknown as FakeXHR;
    xhr.open(method, url);
    xhr.send();
    return xhr;
  }
  it('emits an http.request span carrying method, url and status', () => {
    const xhr = request('https://api.acme.com/users', 'POST');
    xhr.status = 201;
    xhr.dispatch('loadend');
    const span = recorder.spans().find((s) => s.name === SPAN.HTTP_REQUEST);
    expect(span?.attributes[ATTR.HTTP_METHOD]).toBe('POST');
    expect(span?.attributes[ATTR.HTTP_URL]).toBe('https://api.acme.com/users');
    expect(span?.attributes[ATTR.HTTP_STATUS_CODE]).toBe(201);
    expect(typeof span?.attributes[ATTR.HTTP_DURATION_MS]).toBe('number');
  });
  it('injects a traceparent carrying the http.request span ids, not random ones', () => {
    const xhr = request('https://api.acme.com/x');
    xhr.status = 200;
    xhr.dispatch('loadend');
    const span = recorder.spans().find((s) => s.name === SPAN.HTTP_REQUEST);
    const [version, traceId, spanId, flags] = (xhr.headers.traceparent ?? '').split('-');
    expect(version).toBe('00');
    expect(flags).toBe('01');
    expect(traceId).toBe(span?.spanContext().traceId);
    expect(spanId).toBe(span?.spanContext().spanId);
  });
  it('does NOT inject traceparent on third-party hosts', () => {
    const xhr = request('https://fonts.googleapis.com/x');
    xhr.status = 200;
    xhr.dispatch('loadend');
    expect(xhr.headers.traceparent).toBeUndefined();
    expect(recorder.spans().some((s) => s.name === SPAN.HTTP_REQUEST)).toBe(true);
  });
  it('skips its own collector endpoint to avoid recursion', () => {
    const xhr = request('http://collector.example:4318/v1/traces', 'POST');
    xhr.status = 200;
    xhr.dispatch('loadend');
    expect(recorder.spans().some((s) => s.name === SPAN.HTTP_REQUEST)).toBe(false);
    expect(xhr.headers.traceparent).toBeUndefined();
  });
  it('records http.error and ERROR status on a transport failure', () => {
    const xhr = request('https://api.acme.com/oops');
    xhr.dispatch('error');
    const span = recorder.spans().find((s) => s.name === SPAN.HTTP_REQUEST);
    expect(span?.attributes[ATTR.HTTP_ERROR]).toBe('network error');
    expect(span?.attributes[ATTR.HTTP_STATUS_CODE]).toBe(0);
    expect(span?.status.code).toBe(2);
  });
  it('honours beforeSend dropping an http.request span', async () => {
    dispose();
    const filtered = new Scout(
      {
        serviceName: 't',
        endpoint: 'http://collector.example:4318',
        secure: false,
        sessionSampleRate: 100,
        firstPartyHosts: ['api.acme.com'],
        beforeSend: (event) => (event.name === SPAN.HTTP_REQUEST ? null : event),
      },
      memoryPlatform(),
    );
    await filtered.bootstrap();
    dispose = installNetworkTracker(filtered);
    const xhr = request('https://api.acme.com/x');
    xhr.status = 200;
    xhr.dispatch('loadend');
    expect(recorder.spans().some((s) => s.name === SPAN.HTTP_REQUEST)).toBe(false);
    expect(xhr.headers.traceparent).toBeUndefined();
  });
});
