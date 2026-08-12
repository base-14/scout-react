import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Scout } from './scout';
import { ATTR } from './attributes';
import { makeRecorder, memoryPlatform, type Recorder } from '../test/recorder';

async function makeScout(overrides: Record<string, unknown> = {}) {
  const s = new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
      ...overrides,
    },
    memoryPlatform(),
  );
  await s.bootstrap();
  return s;
}

describe('setWebViewBridge — session adoption', () => {
  let rec: Recorder;
  beforeEach(() => {
    rec = makeRecorder();
  });

  it('adopts the host session id onto subsequent spans', async () => {
    const s = await makeScout();
    const own = s.sessionId;
    s.setWebViewBridge({ sessionId: 'native-session-42' });
    expect(s.sessionId).toBe('native-session-42');
    expect(s.sessionId).not.toBe(own);
    s.logEvent('after_adopt', {});
    const span = rec.spans().find((x) => x.name === 'after_adopt');
    expect(span?.attributes[ATTR.SESSION_ID]).toBe('native-session-42');
  });

  it('adopts the host anonymous id onto subsequent spans', async () => {
    const s = await makeScout();
    s.setWebViewBridge({ anonymousId: 'anon-abc' });
    s.logEvent('after_adopt', {});
    const span = rec.spans().find((x) => x.name === 'after_adopt');
    expect(span?.attributes[ATTR.USER_ANONYMOUS_ID]).toBe('anon-abc');
  });

  it('forces the adopted session to be sampled', async () => {
    const s = await makeScout({ sessionSampleRate: 0 });
    s.setWebViewBridge({ sessionId: 'native-session-42' });
    s.logEvent('sampled_in', {});
    expect(rec.spans().some((x) => x.name === 'sampled_in')).toBe(true);
  });

  it('ignores empty and non-string identity fields', async () => {
    const s = await makeScout();
    const own = s.sessionId;
    s.setWebViewBridge({ sessionId: '', anonymousId: '' });
    s.setWebViewBridge({ sessionId: 42 as unknown as string });
    expect(s.sessionId).toBe(own);
  });

  it('tolerates an empty bridge object', async () => {
    const s = await makeScout();
    expect(() => s.setWebViewBridge({})).not.toThrow();
  });
});

describe('setWebViewBridge — span forwarding', () => {
  beforeEach(() => {
    makeRecorder();
  });

  it('hands every emitted span to send()', async () => {
    const send = vi.fn();
    const s = await makeScout();
    s.setWebViewBridge({ send });
    s.logEvent('checkout_started', { sku: 'SKU-1' });
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.type).toBe('checkout_started');
    expect(payload.attributes.sku).toBe('SKU-1');
    expect(typeof payload.timestamp_ms).toBe('number');
  });

  it('forwards the host session id on bridged payloads', async () => {
    const send = vi.fn();
    const s = await makeScout();
    s.setWebViewBridge({ sessionId: 'native-session-42', send });
    s.logEvent('tap', {});
    expect(send.mock.calls[0][0].attributes[ATTR.SESSION_ID]).toBe('native-session-42');
  });

  it('does not let a throwing send() break span emission', async () => {
    const s = await makeScout();
    s.setWebViewBridge({
      send: () => {
        throw new Error('channel closed');
      },
    });
    expect(() => s.logEvent('still_emits', {})).not.toThrow();
  });

  it('forwards spans ended through startTrackedSpan', async () => {
    const send = vi.fn();
    const s = await makeScout();
    s.setWebViewBridge({ send });
    const tracked = s.startTrackedSpan('http.request', { 'http.method': 'GET' });
    expect(tracked).not.toBeNull();
    tracked!.end({ 'http.status_code': 200 });
    const payload = send.mock.calls.at(-1)![0];
    expect(payload.type).toBe('http.request');
    expect(payload.attributes['http.status_code']).toBe(200);
  });

  it('does not forward spans dropped by sampling', async () => {
    const send = vi.fn();
    const s = await makeScout({ sessionSampleRate: 0, alwaysCaptureErrors: false });
    s.setWebViewBridge({ send });
    s.logEvent('dropped', {});
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Scout.isRelaying', () => {
  it('is true only when relay and send are both present', () => {
    const send = vi.fn();
    expect(Scout.isRelaying({ send, relay: true })).toBe(true);
    expect(Scout.isRelaying({ send })).toBe(false);
    expect(Scout.isRelaying({ send, relay: false })).toBe(false);
    expect(Scout.isRelaying({ relay: true })).toBe(false);
    expect(Scout.isRelaying({ sessionId: 'x' })).toBe(false);
    expect(Scout.isRelaying({})).toBe(false);
  });
});
