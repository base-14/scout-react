import { beforeEach, describe, expect, it } from 'vitest';
import { Scout } from './scout';
import { ATTR } from './attributes';
import { SPAN } from './spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../test/recorder';
async function makeScout(overrides: Record<string, unknown> = {}) {
  const platform = memoryPlatform();
  const s = new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
      ...overrides,
    },
    platform,
  );
  await s.bootstrap();
  return s;
}
describe('Scout.commonAttributes', () => {
  beforeEach(() => {
    makeRecorder();
  });
  it('includes session.id and network.connection.type', async () => {
    const s = await makeScout();
    const attrs = s.commonAttributes();
    expect(attrs[ATTR.SESSION_ID]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(attrs[ATTR.NETWORK_CONNECTION_TYPE]).toBe('unknown');
  });
  it('includes user.id and user.* attrs once setUser is called', async () => {
    const s = await makeScout();
    s.setUser('u-123', { email: 'a@b.c', plan: 'pro' });
    const attrs = s.commonAttributes();
    expect(attrs[ATTR.USER_ID]).toBe('u-123');
    expect(attrs['user.email']).toBe('a@b.c');
    expect(attrs['user.plan']).toBe('pro');
  });
  it('passes through user attrs already prefixed with user.', async () => {
    const s = await makeScout();
    s.setUser('u-1', { 'user.email': 'a@b.c', plan: 'pro' });
    const attrs = s.commonAttributes();
    expect(attrs['user.email']).toBe('a@b.c');
    expect(attrs['user.user.email']).toBeUndefined();
    expect(attrs['user.plan']).toBe('pro');
  });
  it('drops user attrs after clearUser', async () => {
    const s = await makeScout();
    s.setUser('u-1', { email: 'a@b.c' });
    s.clearUser();
    const attrs = s.commonAttributes();
    expect(attrs[ATTR.USER_ID]).toBeUndefined();
    expect(attrs['user.email']).toBeUndefined();
  });
  it('lifts runtime attrs (battery, etc.) into common attrs', async () => {
    const s = await makeScout();
    s.setRuntimeAttribute(ATTR.DEVICE_BATTERY_LEVEL, 72);
    s.setRuntimeAttribute(ATTR.DEVICE_BATTERY_STATE, 'charging');
    const attrs = s.commonAttributes();
    expect(attrs[ATTR.DEVICE_BATTERY_LEVEL]).toBe(72);
    expect(attrs[ATTR.DEVICE_BATTERY_STATE]).toBe('charging');
  });
  it('clearing a runtime attribute by setting null removes it', async () => {
    const s = await makeScout();
    s.setRuntimeAttribute(ATTR.DEVICE_BATTERY_LEVEL, 50);
    s.setRuntimeAttribute(ATTR.DEVICE_BATTERY_LEVEL, null);
    expect(s.commonAttributes()[ATTR.DEVICE_BATTERY_LEVEL]).toBeUndefined();
  });
});
describe('Scout.emitSpan', () => {
  let recorder: Recorder;
  beforeEach(() => {
    recorder = makeRecorder();
  });
  it('emits a span with the right name and attributes', async () => {
    const s = await makeScout();
    s.emitSpan('demo', { foo: 'bar' });
    const spans = recorder.spans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('demo');
    expect(spans[0]?.attributes.foo).toBe('bar');
  });
  it('returns null when the session is not sampled', async () => {
    const s = await makeScout({ sessionSampleRate: 0 });
    const result = s.emitSpan('demo', {});
    expect(result).toBeNull();
    expect(recorder.spans()).toHaveLength(0);
  });
  it('skips the span when beforeSend returns null', async () => {
    const s = await makeScout({ beforeSend: () => null });
    s.emitSpan('demo', { foo: 'bar' });
    expect(recorder.spans()).toHaveLength(0);
  });
  it('passes type and name into beforeSend and strips them before export', async () => {
    let seen: any = null;
    const s = await makeScout({
      beforeSend: (e: any) => {
        seen = e;
        return e;
      },
    });
    s.emitSpan('foo', { keep: 1 });
    expect(seen?.type).toBe('span');
    expect(seen?.name).toBe('foo');
    const span = recorder.spans()[0];
    expect(span?.attributes.keep).toBe(1);
    expect(span?.attributes.type).toBeUndefined();
    expect(span?.attributes.name).toBeUndefined();
  });
  it('parents new spans under the current root span (shared trace id)', async () => {
    const s = await makeScout();
    s.startRootSpan(SPAN.SCREEN_VIEW, { [ATTR.SCREEN_NAME]: '/home' });
    s.emitSpan('user_interaction', {});
    s.emitSpan('http.request', {});
    s.setRootSpan(null);
    const all = recorder.spans();
    const rootTrace = all
      .find((sp) => sp.name === SPAN.SCREEN_VIEW)
      ?.spanContext().traceId;
    const interaction = all.find((sp) => sp.name === 'user_interaction');
    const http = all.find((sp) => sp.name === 'http.request');
    expect(rootTrace).toBeDefined();
    expect(interaction?.spanContext().traceId).toBe(rootTrace);
    expect(http?.spanContext().traceId).toBe(rootTrace);
  });
  it('rotates root span — new trace id on next root', async () => {
    const s = await makeScout();
    s.startRootSpan(SPAN.SCREEN_VIEW, { [ATTR.SCREEN_NAME]: '/a' });
    s.emitSpan('x', {});
    s.startRootSpan(SPAN.SCREEN_VIEW, { [ATTR.SCREEN_NAME]: '/b' });
    s.emitSpan('y', {});
    s.setRootSpan(null);
    const all = recorder.spans();
    const x = all.find((sp) => sp.name === 'x')?.spanContext().traceId;
    const y = all.find((sp) => sp.name === 'y')?.spanContext().traceId;
    expect(x).toBeDefined();
    expect(y).toBeDefined();
    expect(x).not.toBe(y);
  });
});
describe('Scout.reportError', () => {
  let recorder: Recorder;
  beforeEach(() => {
    recorder = makeRecorder();
  });
  it('emits an error span with handled=true by default', async () => {
    const s = await makeScout();
    s.reportError(new Error('kaboom'));
    const span = recorder.spans()[0];
    expect(span?.name).toBe(SPAN.ERROR);
    expect(span?.attributes[ATTR.ERROR_TYPE]).toBe('manual_error');
    expect(span?.attributes[ATTR.ERROR_MESSAGE]).toBe('kaboom');
    expect(span?.attributes[ATTR.ERROR_HANDLED]).toBe('true');
    expect(span?.attributes[ATTR.ERROR_STACK_TRACE]).toBeTruthy();
  });
  it('attaches the breadcrumb trail to the error span', async () => {
    const s = await makeScout();
    s.addBreadcrumb('tap', 'pressed Add');
    s.addBreadcrumb('navigation', 'screen: /cart');
    s.reportError(new Error('boom'));
    const span = recorder.spans()[0];
    const crumbs = JSON.parse(span?.attributes[ATTR.BREADCRUMBS] as string);
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].type).toBe('tap');
    expect(crumbs[1].type).toBe('navigation');
  });
});
describe('Scout.reportUncaught', () => {
  let recorder: Recorder;
  beforeEach(() => {
    recorder = makeRecorder();
  });
  it('emits an error span with handled=false and type uncaught_error', async () => {
    const s = await makeScout();
    s.reportUncaught(new Error('async fail'));
    const span = recorder.spans()[0];
    expect(span?.attributes[ATTR.ERROR_TYPE]).toBe('uncaught_error');
    expect(span?.attributes[ATTR.ERROR_HANDLED]).toBe('false');
  });
});
describe('errors bypass session sampling by default', () => {
  let recorder: Recorder;
  beforeEach(() => {
    recorder = makeRecorder();
  });
  it('reportError still emits when sessionSampleRate=0 and alwaysCaptureErrors defaults to true', async () => {
    const s = await makeScout({ sessionSampleRate: 0 });
    s.reportError(new Error('kaboom'));
    expect(recorder.spans()).toHaveLength(1);
    expect(recorder.spans()[0]?.name).toBe(SPAN.ERROR);
  });
  it('reportUncaught still emits when sessionSampleRate=0 and alwaysCaptureErrors defaults to true', async () => {
    const s = await makeScout({ sessionSampleRate: 0 });
    s.reportUncaught(new Error('async fail'));
    expect(recorder.spans()).toHaveLength(1);
    expect(recorder.spans()[0]?.attributes[ATTR.ERROR_TYPE]).toBe('uncaught_error');
  });
  it('logError still emits when sessionSampleRate=0 and alwaysCaptureErrors defaults to true', async () => {
    const s = await makeScout({ sessionSampleRate: 0 });
    s.logError('payment failed');
    expect(recorder.logs()).toHaveLength(1);
    expect(recorder.logs()[0]?.severityText).toBe('ERROR');
  });
  it('reportError respects sampling when alwaysCaptureErrors=false', async () => {
    const s = await makeScout({ sessionSampleRate: 0, alwaysCaptureErrors: false });
    s.reportError(new Error('kaboom'));
    expect(recorder.spans()).toHaveLength(0);
  });
  it('logError respects sampling when alwaysCaptureErrors=false', async () => {
    const s = await makeScout({ sessionSampleRate: 0, alwaysCaptureErrors: false });
    s.logError('payment failed');
    expect(recorder.logs()).toHaveLength(0);
  });
  it('native_crash span bypasses sampling by default', async () => {
    const s = await makeScout({ sessionSampleRate: 0 });
    s.emitSpan(SPAN.NATIVE_CRASH, { 'crash.type': 'SIGSEGV' });
    expect(recorder.spans()).toHaveLength(1);
    expect(recorder.spans()[0]?.name).toBe(SPAN.NATIVE_CRASH);
  });
  it('app_crash span bypasses sampling by default', async () => {
    const s = await makeScout({ sessionSampleRate: 0 });
    s.emitSpan(SPAN.APP_CRASH, { 'crash.reason': 'oom' });
    expect(recorder.spans()).toHaveLength(1);
    expect(recorder.spans()[0]?.name).toBe(SPAN.APP_CRASH);
  });
  it('anr span bypasses sampling by default', async () => {
    const s = await makeScout({ sessionSampleRate: 0 });
    s.emitSpan(SPAN.ANR, { 'anr.duration_ms': 6000 });
    expect(recorder.spans()).toHaveLength(1);
    expect(recorder.spans()[0]?.name).toBe(SPAN.ANR);
  });
  it('non-error spans still respect sampling when sessionSampleRate=0', async () => {
    const s = await makeScout({ sessionSampleRate: 0 });
    s.emitSpan(SPAN.USER_INTERACTION, { 'user_interaction.target': '#btn' });
    s.emitSpan(SPAN.HTTP_REQUEST, { 'http.url': 'https://api' });
    s.emitSpan(SPAN.LONG_TASK, { 'long_task.duration_ms': 200 });
    expect(recorder.spans()).toHaveLength(0);
  });
  it('all error-class spans respect sampling when alwaysCaptureErrors=false', async () => {
    const s = await makeScout({ sessionSampleRate: 0, alwaysCaptureErrors: false });
    s.emitSpan(SPAN.ERROR, {});
    s.emitSpan(SPAN.NATIVE_CRASH, {});
    s.emitSpan(SPAN.APP_CRASH, {});
    s.emitSpan(SPAN.ANR, {});
    expect(recorder.spans()).toHaveLength(0);
  });
});
describe('Scout log emission', () => {
  let recorder: Recorder;
  beforeEach(() => {
    recorder = makeRecorder();
  });
  it('writes a record with the right severityNumber and body for logInfo', async () => {
    const s = await makeScout();
    s.logInfo('hello world');
    const rec = recorder.logs()[0];
    expect(rec?.severityNumber).toBe(9);
    expect(rec?.severityText).toBe('INFO');
    expect(rec?.body).toBe('hello world');
  });
  it('emits DEBUG / INFO / WARN / ERROR with the spec severityNumbers', async () => {
    const s = await makeScout();
    s.logDebug('d');
    s.logInfo('i');
    s.logWarning('w');
    s.logError('e');
    const recs = recorder.logs();
    expect(recs.map((r) => r.severityNumber)).toEqual([5, 9, 13, 17]);
    expect(recs.map((r) => r.body)).toEqual(['d', 'i', 'w', 'e']);
  });
  it('logError accepts a Flutter-style { error, stackTrace, attributes } opts object', async () => {
    const s = await makeScout();
    const err = new Error('payment failed');
    s.logError('Payment gateway timeout', {
      error: err,
      stackTrace: 'at fakeFrame:1',
      attributes: { gateway: 'stripe' },
    });
    const rec = recorder.logs()[0];
    expect(rec?.attributes['error.message']).toBe('payment failed');
    expect(rec?.attributes['error.stack_trace']).toBe('at fakeFrame:1');
    expect(rec?.attributes.gateway).toBe('stripe');
  });
  it('logInfo accepts plain attributes (backward compatible)', async () => {
    const s = await makeScout();
    s.logInfo('hi', { count: 5 });
    const rec = recorder.logs()[0];
    expect(rec?.attributes.count).toBe(5);
  });
  it('respects enableLogging=false', async () => {
    const s = await makeScout({ enableLogging: false });
    s.logInfo('should not appear');
    expect(recorder.logs()).toHaveLength(0);
  });
});
describe('Scout.logEvent', () => {
  let recorder: Recorder;
  beforeEach(() => {
    recorder = makeRecorder();
  });
  it('emits a span carrying the given name and attributes', async () => {
    const s = await makeScout();
    s.logEvent('purchase_completed', { sku: 'SKU-1', amount: '49.99' });
    const span = recorder.spans()[0];
    expect(span?.name).toBe('purchase_completed');
    expect(span?.attributes.sku).toBe('SKU-1');
    expect(span?.attributes.amount).toBe('49.99');
  });
});
