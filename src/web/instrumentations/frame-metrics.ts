import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
export function installFrameMetricsTracker(scout: Scout): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const ms = entry.duration;
        if (!Number.isFinite(ms) || ms <= 0) continue;
        scout.emitHistogram(METRIC.WEB_FRAME_TIME, ms);
      }
    });
    try {
      observer.observe({ type: 'long-animation-frame', buffered: true });
    } catch {
      observer.observe({ type: 'longtask', buffered: true });
    }
  } catch {
    return () => {};
  }
  return () => {
    try {
      observer?.disconnect();
    } catch {}
  };
}
