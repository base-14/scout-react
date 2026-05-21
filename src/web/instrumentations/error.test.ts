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
