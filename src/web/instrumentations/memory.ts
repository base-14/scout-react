import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
const DEFAULT_SAMPLE_INTERVAL_MS = 60000;
export function installMemoryTracker(
  scout: Scout,
  sampleIntervalMs: number = DEFAULT_SAMPLE_INTERVAL_MS,
): () => void {
  if (typeof performance === 'undefined') return () => {};
  const perf = performance as Performance & {
    memory?: {
      usedJSHeapSize: number;
    };
  };
  if (!perf.memory) return () => {};
  const tick = () => {
    try {
      const bytes = perf.memory?.usedJSHeapSize ?? 0;
      scout.emitGauge(METRIC.WEB_MEMORY_USAGE, bytes);
    } catch {}
  };
  tick();
  const id = setInterval(tick, sampleIntervalMs);
  return () => clearInterval(id);
}
