// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hrTimeToMilliseconds } from '@opentelemetry/core';
import { installAnrDetector } from './anr';
import { Scout } from '../../core/scout';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';

const THRESHOLD_MS = 5000;

async function makeScout() {
  const s = new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
    },
    memoryPlatform(),
  );
  await s.bootstrap();
  return s;
}

/**
 * Captures what the detector posts to its worker, and hands back the real
 * worker source so the worker's own logic can be exercised (see runWorker).
 */
function stubWorker() {
  const posted: Array<Record<string, unknown>> = [];
  let source = '';
  const instance = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage: (m: Record<string, unknown>) => void posted.push(m),
    terminate: vi.fn(),
  };
  vi.stubGlobal(
    'Blob',
    class {
      constructor(parts: string[]) {
        source = parts.join('');
      }
    },
  );
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} });
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return instance as unknown as Worker;
      }
    },
  );
  return {
    posted,
    instance,
    source: () => source,
    /** Delivers an `anr` report from the worker to the main thread. */
    report: (durationMs: number) =>
      instance.onmessage?.({ data: { type: 'anr', durationMs } } as MessageEvent),
  };
}

/** Runs the detector's actual worker source against a fake `self`. */
function runWorker(source: string) {
  const out: Array<Record<string, unknown>> = [];
  const self = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage: (m: Record<string, unknown>) => void out.push(m),
  };
  new Function('self', source)(self);
  return {
    out,
    send: (data: unknown) => self.onmessage?.({ data }),
  };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('ANR detector', () => {
  let recorder: Recorder;
  const disposers: Array<() => void> = [];
  beforeEach(() => {
    recorder = makeRecorder();
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
  afterEach(() => {
    disposers.splice(0).forEach((d) => d());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stops beating while the tab is hidden, so throttling cannot look like a hang', async () => {
    const w = stubWorker();
    const scout = await makeScout();
    disposers.push(installAnrDetector(scout, THRESHOLD_MS));

    vi.advanceTimersByTime(3000);
    expect(w.posted.filter((m) => m.type === 'beat')).toHaveLength(3);

    setVisibility('hidden');
    w.posted.length = 0;
    // A backgrounded tab clamps timers to ~1/min; five minutes of wall clock.
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(w.posted).toHaveLength(0);
  });

  it('resets the worker baseline before beats resume, so the hidden gap is not charged', async () => {
    const w = stubWorker();
    const scout = await makeScout();
    disposers.push(installAnrDetector(scout, THRESHOLD_MS));

    setVisibility('hidden');
    vi.advanceTimersByTime(5 * 60 * 1000);
    w.posted.length = 0;
    setVisibility('visible');

    expect(w.posted[0]).toEqual({ type: 'reset' });
    vi.advanceTimersByTime(1000);
    expect(w.posted[1]).toEqual({ type: 'beat' });
  });

  it('does not beat when installed into an already-hidden tab', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    const w = stubWorker();
    const scout = await makeScout();
    disposers.push(installAnrDetector(scout, THRESHOLD_MS));

    vi.advanceTimersByTime(10_000);
    expect(w.posted).toHaveLength(0);
  });

  it('emits a span whose duration is the hang, in milliseconds', async () => {
    const w = stubWorker();
    const scout = await makeScout();
    disposers.push(installAnrDetector(scout, THRESHOLD_MS));

    w.report(7000);

    const spans = recorder.spans().filter((s) => s.name === SPAN.ANR);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(hrTimeToMilliseconds(span.duration)).toBeCloseTo(7000, 0);
    expect(span.attributes['anr.duration_ms']).toBe(7000);
    expect(span.attributes['anr.threshold_ms']).toBe(THRESHOLD_MS);
    expect(span.attributes['anr.visibility_state']).toBe('visible');
    // The ambiguous seconds keys are gone, not merely supplemented.
    expect(span.attributes['anr.duration']).toBeUndefined();
    expect(span.attributes['anr.threshold']).toBeUndefined();
  });

  it('ignores a non-positive or unparseable duration', async () => {
    const w = stubWorker();
    const scout = await makeScout();
    disposers.push(installAnrDetector(scout, THRESHOLD_MS));

    w.report(0);
    w.report(Number.NaN);

    expect(recorder.spans().filter((s) => s.name === SPAN.ANR)).toHaveLength(0);
  });

  it('stops beating and terminates the worker on dispose', async () => {
    const w = stubWorker();
    const scout = await makeScout();
    const dispose = installAnrDetector(scout, THRESHOLD_MS);
    dispose();

    w.posted.length = 0;
    vi.advanceTimersByTime(10_000);
    setVisibility('visible');
    expect(w.posted).toHaveLength(0);
    expect(w.instance.terminate).toHaveBeenCalled();
  });

  describe('the worker itself', () => {
    async function sourceOf() {
      const w = stubWorker();
      const scout = await makeScout();
      disposers.push(installAnrDetector(scout, THRESHOLD_MS));
      return w.source();
    }

    it('reports lag beyond the threshold', async () => {
      const worker = runWorker(await sourceOf());
      vi.setSystemTime(Date.now() + 1000 + THRESHOLD_MS + 1);
      worker.send({ type: 'beat' });
      expect(worker.out).toEqual([{ type: 'anr', durationMs: THRESHOLD_MS + 1 }]);
    });

    it('stays quiet for an on-time beat', async () => {
      const worker = runWorker(await sourceOf());
      vi.setSystemTime(Date.now() + 1000);
      worker.send({ type: 'beat' });
      expect(worker.out).toHaveLength(0);
    });

    it('treats `reset` as a new baseline rather than a hang', async () => {
      const worker = runWorker(await sourceOf());
      vi.setSystemTime(Date.now() + 5 * 60 * 1000);
      worker.send({ type: 'reset' });
      vi.setSystemTime(Date.now() + 1000);
      worker.send({ type: 'beat' });
      expect(worker.out).toHaveLength(0);
    });
  });
});
