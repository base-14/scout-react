// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLongTaskTracker } from './long-task';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';

type Entry = { entryType: string; startTime: number; duration: number } & Record<
  string,
  unknown
>;
type Callback = (list: { getEntries(): Entry[] }) => void;

// jsdom has no PerformanceObserver; this fake records one callback per entry
// type and lets a test deliver entries on demand.
const observed: Record<string, Callback[]> = {};
let supportedEntryTypes: string[] = ['longtask'];
class FakePerformanceObserver {
  static get supportedEntryTypes() {
    return supportedEntryTypes;
  }
  constructor(private cb: Callback) {}
  observe(opts: { type: string }) {
    (observed[opts.type] ??= []).push(this.cb);
  }
  disconnect() {}
}
function deliver(type: string, ...entries: Array<Omit<Entry, 'entryType'>>) {
  for (const cb of observed[type] ?? []) {
    cb({ getEntries: () => entries.map((e) => ({ entryType: type, ...e })) });
  }
}

describe('installLongTaskTracker', () => {
  let recorder: Recorder;
  let scout: Scout;
  let clock = 0;
  const disposers: Array<() => void> = [];
  const named = (name: string) => recorder.spans().filter((s) => s.name === name);
  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(async () => {
    recorder = makeRecorder();
    for (const k of Object.keys(observed)) delete observed[k];
    supportedEntryTypes = ['longtask'];
    clock = 0;
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  function install(opts?: { frozenFrameMaxMs?: number }) {
    disposers.push(installLongTaskTracker(scout, 100, opts));
  }

  it('emits a long_task and a frozen_frame for a blocking task while visible', () => {
    install();
    clock = 2000;
    deliver('longtask', { startTime: 1000, duration: 1000 });
    expect(named(SPAN.LONG_TASK)).toHaveLength(1);
    const frozen = named(SPAN.FROZEN_FRAME);
    expect(frozen).toHaveLength(1);
    expect(frozen[0]!.attributes[ATTR.FROZEN_FRAME_DURATION]).toBe(1);
    expect(frozen[0]!.attributes[ATTR.FROZEN_FRAME_CAPPED]).toBeUndefined();
  });

  it('drops a task that spans time the page was hidden', () => {
    // A WebView renderer suspended mid-task by its host reports one task
    // covering the whole suspension when it resumes (B14-2083).
    install();
    clock = 1000;
    setVisibility('hidden');
    clock = 21000;
    setVisibility('visible');
    clock = 21500;
    deliver('longtask', { startTime: 900, duration: 20400 });
    expect(named(SPAN.LONG_TASK)).toHaveLength(0);
    expect(named(SPAN.FROZEN_FRAME)).toHaveLength(0);
  });

  it('drops a task reported while the page is still hidden', () => {
    install();
    clock = 1000;
    setVisibility('hidden');
    clock = 5000;
    deliver('longtask', { startTime: 1500, duration: 800 });
    expect(named(SPAN.FROZEN_FRAME)).toHaveLength(0);
  });

  it('keeps a task that finished before the page was hidden', () => {
    install();
    clock = 1000;
    setVisibility('hidden');
    clock = 2000;
    setVisibility('visible');
    deliver('longtask', { startTime: 100, duration: 800 });
    expect(named(SPAN.FROZEN_FRAME)).toHaveLength(1);
  });

  it('treats freeze / resume like hidden / visible', () => {
    install();
    clock = 1000;
    document.dispatchEvent(new Event('freeze'));
    clock = 9000;
    document.dispatchEvent(new Event('resume'));
    deliver('longtask', { startTime: 500, duration: 8000 });
    expect(named(SPAN.FROZEN_FRAME)).toHaveLength(0);
  });

  it('ignores buffered entries that ended before the SDK was installed', () => {
    clock = 5000;
    install();
    deliver('longtask', { startTime: 1000, duration: 2000 });
    expect(named(SPAN.LONG_TASK)).toHaveLength(0);
  });

  it('caps frozen_frame.duration and flags it', () => {
    install({ frozenFrameMaxMs: 10000 });
    clock = 40000;
    deliver('longtask', { startTime: 10000, duration: 25000 });
    const frozen = named(SPAN.FROZEN_FRAME);
    expect(frozen).toHaveLength(1);
    expect(frozen[0]!.attributes[ATTR.FROZEN_FRAME_DURATION]).toBe(10);
    expect(frozen[0]!.attributes[ATTR.FROZEN_FRAME_CAPPED]).toBe(true);
    // long_task keeps the measured value.
    expect(named(SPAN.LONG_TASK)[0]!.attributes[ATTR.LONG_TASK_DURATION]).toBe(25);
  });

  it('observes only long-animation-frame where the browser supports it', () => {
    // Both observers described the same stall, so one freeze produced two
    // long_task, two frozen_frame and two counter increments.
    supportedEntryTypes = ['longtask', 'long-animation-frame'];
    install();
    expect(observed['longtask']).toBeUndefined();
    expect(observed['long-animation-frame']).toHaveLength(1);
    clock = 2000;
    deliver('long-animation-frame', {
      startTime: 1000,
      duration: 900,
      blockingDuration: 850,
    });
    expect(named(SPAN.LONG_TASK)).toHaveLength(1);
    expect(named(SPAN.FROZEN_FRAME)).toHaveLength(1);
  });

  it('falls back to longtask where long-animation-frame is unsupported', () => {
    install();
    expect(observed['longtask']).toHaveLength(1);
  });
});
