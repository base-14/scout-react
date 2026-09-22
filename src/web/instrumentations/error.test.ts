// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';
import { installErrorTracker } from './error';
describe('installErrorTracker', () => {
  let recorder: Recorder;
  let scout: Scout;
  let dispose: () => void;
  beforeEach(async () => {
    recorder = makeRecorder();
    scout = new Scout(
      {
        serviceName: 't',
        endpoint: 'http://localhost',
        secure: false,
        sessionSampleRate: 100,
      },
      memoryPlatform(),
    );
    await scout.bootstrap();
    dispose = installErrorTracker(scout);
  });
  afterEach(() => {
    dispose();
  });
  async function counters(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const rm of await recorder.metrics()) {
      for (const sm of rm.scopeMetrics) {
        for (const m of sm.metrics) {
          for (const dp of m.dataPoints) {
            out[m.descriptor.name] = (out[m.descriptor.name] ?? 0) + Number(dp.value);
          }
        }
      }
    }
    return out;
  }
  const SDK_STACK = `TypeError: this.o.at is not a function
    at e._processEntry (https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js:1:24567)
    at https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js:1:23980`;
  function sdkError(): Error {
    const e = new TypeError('this.o.at is not a function');
    e.stack = SDK_STACK;
    return e;
  }
  function appError(msg = 'boom'): Error {
    const e = new Error(msg);
    e.stack = `Error: ${msg}
    at onClick (https://expert-webapp.snabbit.com/assets/index-Ab12Cd34.js:4:1200)`;
    return e;
  }
  function raise(err: Error) {
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }));
  }

  it('flags an error thrown inside the SDK bundle and keeps it out of the error counters', async () => {
    scout.setCurrentScreen('/checkout');
    raise(sdkError());
    const span = recorder.spans().find((s) => s.name === SPAN.ERROR);
    expect(span?.attributes[ATTR.ERROR_ORIGIN]).toBe('sdk');
    expect(span?.attributes[ATTR.ERROR_CATEGORY]).toBe('sdk_internal');
    expect(span?.attributes[ATTR.ERROR_TYPE]).toBe('uncaught_error');
    const c = await counters();
    expect(c['error.count'] ?? 0).toBe(0);
    expect(c['view.error.count'] ?? 0).toBe(0);
  });

  it('reports one SDK-internal failure per page, not one per occurrence', () => {
    // web-vitals' observer re-threw on every layout shift for the life of
    // the page; each would otherwise have been its own span.
    raise(sdkError());
    raise(sdkError());
    raise(sdkError());
    expect(recorder.spans().filter((s) => s.name === SPAN.ERROR)).toHaveLength(1);
  });

  it('marks application errors as app-origin and counts them', async () => {
    scout.setCurrentScreen('/checkout');
    raise(appError());
    raise(appError());
    const spans = recorder.spans().filter((s) => s.name === SPAN.ERROR);
    expect(spans).toHaveLength(2);
    expect(spans[0]?.attributes[ATTR.ERROR_ORIGIN]).toBe('app');
    expect(spans[0]?.attributes[ATTR.ERROR_CATEGORY]).toBeUndefined();
    const c = await counters();
    expect(c['error.count']).toBe(2);
    expect(c['view.error.count']).toBe(2);
  });

  it('captures window error events as uncaught error spans', () => {
    const err = new Error('boom');
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'boom' }));
    const span = recorder.spans().find((s) => s.name === SPAN.ERROR);
    expect(span?.attributes[ATTR.ERROR_TYPE]).toBe('uncaught_error');
    expect(span?.attributes[ATTR.ERROR_HANDLED]).toBe('false');
    expect(span?.attributes[ATTR.ERROR_MESSAGE]).toBe('boom');
  });
  it('captures unhandled promise rejections as uncaught error spans', async () => {
    const err = new Error('rejected');
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: err });
    window.dispatchEvent(event);
    const span = recorder.spans().find((s) => s.name === SPAN.ERROR);
    expect(span?.attributes[ATTR.ERROR_TYPE]).toBe('uncaught_error');
    expect(span?.attributes[ATTR.ERROR_MESSAGE]).toBe('rejected');
  });
  it('wraps a non-Error reason into an Error before reporting', () => {
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: 'string reason' });
    window.dispatchEvent(event);
    const span = recorder.spans().find((s) => s.name === SPAN.ERROR);
    expect(span?.attributes[ATTR.ERROR_MESSAGE]).toBe('string reason');
  });
});
