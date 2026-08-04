import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installMemoryTracker } from './memory';
import type { Scout } from '../../core/scout';

describe('memory tracker sampling cadence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (performance as unknown as { memory: unknown }).memory = { usedJSHeapSize: 1024 };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (performance as unknown as { memory?: unknown }).memory;
  });

  function track(intervalMs?: number) {
    const emitGauge = vi.fn();
    const scout = { emitGauge } as unknown as Scout;
    const dispose =
      intervalMs === undefined
        ? installMemoryTracker(scout)
        : installMemoryTracker(scout, intervalMs);
    return { emitGauge, dispose };
  }

  it('samples once at install, then on the default 60s cadence', () => {
    const { emitGauge, dispose } = track();
    expect(emitGauge).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(59_000);
    expect(emitGauge).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(emitGauge).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('honours a configured vitals interval', () => {
    const { emitGauge, dispose } = track(5_000);
    vi.advanceTimersByTime(15_000);
    expect(emitGauge).toHaveBeenCalledTimes(4); // install + 3 ticks
    dispose();
  });

  it('stops sampling once disposed', () => {
    const { emitGauge, dispose } = track(5_000);
    dispose();
    vi.advanceTimersByTime(60_000);
    expect(emitGauge).toHaveBeenCalledTimes(1);
  });
});
