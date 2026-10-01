import { describe, it, expect, vi, afterEach } from 'vitest';
import { isEmbeddedWebView, WebPlatform } from './platform';
import { ATTR } from '../core/attributes';

const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 15; itel A6611L Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.7151.115 Mobile Safari/537.36';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';
const IOS_WKWEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IOS_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

describe('isEmbeddedWebView', () => {
  it('recognises the Android system WebView by its wv token', () => {
    expect(isEmbeddedWebView(ANDROID_WEBVIEW)).toBe(true);
  });
  it('recognises an iOS WKWebView by the missing Safari product', () => {
    expect(isEmbeddedWebView(IOS_WKWEBVIEW)).toBe(true);
  });
  it.each([
    ['Android Chrome', ANDROID_CHROME],
    ['iOS Safari', IOS_SAFARI],
    ['iOS Chrome', IOS_CHROME],
    ['desktop Chrome', DESKTOP_CHROME],
  ])('treats %s as a browser', (_label, ua) => {
    expect(isEmbeddedWebView(ua)).toBe(false);
  });
  it('treats an unknown runtime as a browser', () => {
    expect(isEmbeddedWebView('')).toBe(false);
    expect(isEmbeddedWebView(undefined as unknown as string)).toBe(
      isEmbeddedWebView(globalThis.navigator?.userAgent),
    );
  });
});

describe('WebPlatform network signals', () => {
  const CELLULAR = { type: 'cellular', effectiveType: '4g', rtt: 100, downlink: 1.55 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the transport as the connection type, not the effective type', () => {
    vi.stubGlobal('navigator', { connection: CELLULAR });
    expect(new WebPlatform().getConnectionType()).toBe('cellular');
  });

  it('exposes effectiveType, rtt and downlink as network quality', () => {
    vi.stubGlobal('navigator', { connection: CELLULAR });
    expect(new WebPlatform().getNetworkQuality()).toEqual({
      effectiveType: '4g',
      rttMs: 100,
      downlinkMbps: 1.55,
    });
  });

  it('degrades to unknown where the Network Information API is absent', () => {
    vi.stubGlobal('navigator', {});
    const platform = new WebPlatform();
    expect(platform.getConnectionType()).toBe('unknown');
    expect(platform.getNetworkQuality()).toEqual({});
  });

  it('stamps the live transport on the resource instead of a literal unknown', async () => {
    vi.stubGlobal('navigator', { connection: { type: 'wifi', effectiveType: '4g' } });
    const attrs = await new WebPlatform().collectResourceAttributes();
    expect(attrs[ATTR.NETWORK_CONNECTION_TYPE]).toBe('wifi');
  });
});
