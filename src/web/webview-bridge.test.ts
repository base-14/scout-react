// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trace, metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';

// Every OTLP write goes out over fetch, so counting trace POSTs is the only
// honest way to assert that relay mode actually stops the page exporting.
function tracePosts(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/v1/traces')).length;
}

describe('web WebView bridge', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    const { Scout } = await import('./index');
    await Scout.shutdown();
    // The OTel API keeps its global providers outside the module graph, so
    // resetModules alone leaves the next test emitting into this test's
    // (already shut down) exporters. Disable them explicitly.
    trace.disable();
    metrics.disable();
    logs.disable();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function initialize(config: Record<string, unknown> = {}) {
    const { Scout } = await import('./index');
    await Scout.initialize({
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
      ...config,
    } as never);
    return Scout;
  }

  it('exposes Scout on window so a host shim can find it', async () => {
    await import('./index');
    expect(
      (window as unknown as { Scout?: { setWebViewBridge?: unknown } }).Scout
        ?.setWebViewBridge,
    ).toBeTypeOf('function');
  });

  it('keeps exporting spans in session-adoption-only mode', async () => {
    const Scout = await initialize();
    Scout.setWebViewBridge({ sessionId: 'native-1', anonymousId: 'anon-1' });
    expect(Scout.isExportingSpans).toBe(true);
    expect(Scout.sessionId).toBe('native-1');
    Scout.logEvent('adopted', {});
    await Scout.flush();
    expect(tracePosts(fetchMock)).toBeGreaterThan(0);
  });

  it('keeps exporting spans in mirror mode (send without relay)', async () => {
    const Scout = await initialize();
    const send = vi.fn();
    Scout.setWebViewBridge({ sessionId: 'native-1', send });
    expect(Scout.isExportingSpans).toBe(true);
    Scout.logEvent('mirrored', {});
    await Scout.flush();
    expect(send).toHaveBeenCalled();
    expect(tracePosts(fetchMock)).toBeGreaterThan(0);
  });

  it('stops exporting spans in relay mode, and forwards them instead', async () => {
    const Scout = await initialize();
    const send = vi.fn();
    Scout.setWebViewBridge({ sessionId: 'native-1', send, relay: true });
    expect(Scout.isExportingSpans).toBe(false);
    Scout.logEvent('relayed', {});
    await Scout.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].type).toBe('relayed');
    expect(tracePosts(fetchMock)).toBe(0);
  });

  it('reopens the gate when the host detaches the relay', async () => {
    const Scout = await initialize();
    const send = vi.fn();
    Scout.setWebViewBridge({ send, relay: true });
    expect(Scout.isExportingSpans).toBe(false);
    Scout.setWebViewBridge({ sessionId: 'native-1' });
    expect(Scout.isExportingSpans).toBe(true);
    Scout.logEvent('after_detach', {});
    await Scout.flush();
    expect(tracePosts(fetchMock)).toBeGreaterThan(0);
  });

  it('applies a bridge injected before initialize(), gate included', async () => {
    const { Scout } = await import('./index');
    const send = vi.fn();
    Scout.setWebViewBridge({ sessionId: 'native-early', send, relay: true });
    await Scout.initialize({
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
    } as never);
    expect(Scout.sessionId).toBe('native-early');
    expect(Scout.isExportingSpans).toBe(false);
    Scout.logEvent('early', {});
    await Scout.flush();
    expect(tracePosts(fetchMock)).toBe(0);
  });

  it('reports spans as exporting before initialize()', async () => {
    const { Scout } = await import('./index');
    expect(Scout.isExportingSpans).toBe(true);
  });

  it('leaves logs exporting in relay mode — the bridge carries spans only', async () => {
    const Scout = await initialize();
    Scout.setWebViewBridge({ send: vi.fn(), relay: true });
    Scout.logInfo('still shipped over http');
    await Scout.flush();
    const logPosts = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/logs'),
    ).length;
    expect(logPosts).toBeGreaterThan(0);
  });
});
