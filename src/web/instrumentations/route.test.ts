// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';
import { installRouteTracker } from './route';
async function wait(ms = 10) {
  await new Promise((r) => setTimeout(r, ms));
}
describe('installRouteTracker', () => {
  let recorder: Recorder;
  let scout: Scout;
  let dispose: () => void;
  beforeEach(async () => {
    history.replaceState({}, '', '/');
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
    dispose = installRouteTracker(scout);
  });
  afterEach(() => {
    dispose();
  });
  it('starts a screen_view root span on install for the current path', async () => {
    await wait();
    const root = recorder.spans().find((s) => s.name === SPAN.SCREEN_VIEW);
    expect(scout.rootSpan).not.toBeNull();
    await wait(50);
    const load = recorder.spans().find((s) => s.name === SPAN.SCREEN_LOAD);
    expect(load?.attributes[ATTR.SCREEN_NAME]).toBe('/');
    void root;
  });
  it('emits a view_session span when navigating away', async () => {
    await wait();
    history.pushState({}, '', '/details');
    await wait(50);
    const view = recorder.spans().find((s) => s.name === SPAN.VIEW_SESSION);
    expect(view?.attributes[ATTR.SCREEN_NAME]).toBe('/');
    expect(typeof view?.attributes[ATTR.VIEW_TIME_SPENT]).toBe('number');
  });
  it('emits a new screen_view span on each pushState', async () => {
    await wait();
    history.pushState({}, '', '/details');
    await wait();
    history.pushState({}, '', '/profile');
    await wait(50);
    const screens = recorder
      .spans()
      .filter((s) => s.name === SPAN.SCREEN_VIEW)
      .map((s) => s.attributes[ATTR.SCREEN_NAME]);
    expect(screens).toContain('/');
    expect(screens).toContain('/details');
  });
  it('rotates the trace id between screens', async () => {
    await wait();
    const traceA = scout.rootSpan?.spanContext().traceId;
    history.pushState({}, '', '/details');
    await wait();
    const traceB = scout.rootSpan?.spanContext().traceId;
    expect(traceA).toBeTruthy();
    expect(traceB).toBeTruthy();
    expect(traceA).not.toBe(traceB);
  });
  it('skips emission when pathname does not change (e.g. hash-only)', async () => {
    await wait();
    const before = recorder.spans().filter((s) => s.name === SPAN.SCREEN_VIEW).length;
    history.replaceState({}, '', '/');
    await wait();
    const after = recorder.spans().filter((s) => s.name === SPAN.SCREEN_VIEW).length;
    expect(after).toBe(before);
  });
});
