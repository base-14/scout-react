// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { trace, metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';

const MARKER_KEY = 'scout.session-marker:test-svc:';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 15; itel A6611L Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.7151.115 Mobile Safari/537.36';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';

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

describe('enableUncleanExitDetection gate', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    );
  });

  afterEach(async () => {
    const { Scout } = await import('./index');
    await Scout.shutdown();
    trace.disable();
    metrics.disable();
    logs.disable();
    vi.unstubAllGlobals();
    vi.resetModules();
    delete (navigator as { userAgent?: unknown }).userAgent;
  });

  function setUserAgent(ua: string) {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
  }

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

  it('arms the session marker in a browser', async () => {
    setUserAgent(ANDROID_CHROME);
    await initialize();
    expect(storage.getItem(MARKER_KEY)).not.toBeNull();
  });

  it('does not arm the session marker inside an embedded WebView by default', async () => {
    // The host closes the WebView without pagehide, so every routine close
    // would otherwise be filed as an unclean exit on the next open.
    setUserAgent(ANDROID_WEBVIEW);
    await initialize();
    expect(storage.getItem(MARKER_KEY)).toBeNull();
  });

  it('lets the integrator force detection on inside a WebView', async () => {
    setUserAgent(ANDROID_WEBVIEW);
    await initialize({ enableUncleanExitDetection: true });
    expect(storage.getItem(MARKER_KEY)).not.toBeNull();
  });

  it('lets the integrator turn detection off in a browser', async () => {
    setUserAgent(ANDROID_CHROME);
    await initialize({ enableUncleanExitDetection: false });
    expect(storage.getItem(MARKER_KEY)).toBeNull();
  });
});
