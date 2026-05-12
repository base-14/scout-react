import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
export function installMemoryTracker(scout: Scout): () => void {
    if (typeof performance === 'undefined')
        return () => { };
    const perf = performance as Performance & {
        memory?: {
            usedJSHeapSize: number;
        };
    };
    if (!perf.memory)
        return () => { };
    const tick = () => {
        try {
            const bytes = perf.memory?.usedJSHeapSize ?? 0;
            scout.emitGauge(METRIC.WEB_MEMORY_USAGE, bytes);
        }
        catch {
        }
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
}
