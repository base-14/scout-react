import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNativeFrameMetricsTracker, type AppStateLike } from './frame-metrics';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';

// A hand-cranked requestAnimationFrame: the test decides when each frame
// lands and with what timestamp, standing in for the RN frame scheduler.
let pending: Array<(t: number) => void> = [];
function frame(ts: number) {
  const cbs = pending;
  pending = [];
  for (const cb of cbs) cb(ts);
}
function fakeAppState(initial = 'active'): AppStateLike & { set(state: string): void } {
  let handler: ((s: string) => void) | null = null;
  return {
    currentState: initial,
    addEventListener(_type, h) {
      handler = h;
      return { remove: () => (handler = null) };
    },
    set(state: string) {
      this.currentState = state;
      handler?.(state);
    },
  };
}

describe('installNativeFrameMetricsTracker', () => {
  let recorder: Recorder;
  let scout: Scout;
  const disposers: Array<() => void> = [];
  const named = (name: string) => recorder.spans().filter((s) => s.name === name);

  beforeEach(async () => {
    recorder = makeRecorder();
    pending = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      pending.push(cb);
      return pending.length;
    });
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
  });
  afterEach(() => {
    disposers.splice(0).forEach((d) => d());
    vi.unstubAllGlobals();
  });

  function install(appState: AppStateLike | null, frozenFrameMaxMs?: number) {
    disposers.push(
      installNativeFrameMetricsTracker(scout, 100, 60000, { appState, frozenFrameMaxMs }),
    );
  }

  it('reports a long frame gap as a frozen frame while active', () => {
    install(fakeAppState());
    frame(0);
    frame(1000);
    const frozen = named(SPAN.FROZEN_FRAME);
    expect(frozen).toHaveLength(1);
    expect(frozen[0]!.attributes[ATTR.FROZEN_FRAME_DURATION]).toBe(1);
  });

  it('does not report the gap spent in the background as a frozen frame', () => {
    // rAF stops while backgrounded, so the first frame after resume arrived
    // as one gap the length of the whole background stay (B14-2083).
    const appState = fakeAppState();
    install(appState);
    frame(0);
    frame(16);
    appState.set('background');
    appState.set('active');
    frame(20016);
    expect(named(SPAN.FROZEN_FRAME)).toHaveLength(0);
    expect(named(SPAN.LONG_TASK)).toHaveLength(0);
    // Measurement resumes from the first foreground frame.
    frame(21016);
    expect(named(SPAN.FROZEN_FRAME)).toHaveLength(1);
  });

  it('ignores frames delivered while still in the background', () => {
    const appState = fakeAppState();
    install(appState);
    frame(0);
    appState.set('background');
    frame(5000);
    frame(6000);
    expect(named(SPAN.FROZEN_FRAME)).toHaveLength(0);
  });

  it('caps frozen_frame.duration and flags it', () => {
    install(fakeAppState(), 10000);
    frame(0);
    frame(25000);
    const frozen = named(SPAN.FROZEN_FRAME);
    expect(frozen).toHaveLength(1);
    expect(frozen[0]!.attributes[ATTR.FROZEN_FRAME_DURATION]).toBe(10);
    expect(frozen[0]!.attributes[ATTR.FROZEN_FRAME_CAPPED]).toBe(true);
  });

  it('measures normally when AppState is unavailable', () => {
    install(null);
    frame(0);
    frame(900);
    expect(named(SPAN.FROZEN_FRAME)).toHaveLength(1);
  });
});
