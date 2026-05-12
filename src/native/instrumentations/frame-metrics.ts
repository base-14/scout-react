import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
const FROZEN_FRAME_MS = 700;
export function installNativeFrameMetricsTracker(scout: Scout, longTaskThresholdMs: number): () => void {
    const raf: ((cb: (t: number) => void) => number) | undefined = (globalThis as any)
        .requestAnimationFrame;
    if (typeof raf !== 'function')
        return () => { };
    let lastTs = -1;
    let stopped = false;
    let droppedSinceLastReport = 0;
    const tick = (ts: number) => {
        if (stopped)
            return;
        if (lastTs >= 0) {
            const delta = ts - lastTs;
            if (delta > 50) {
                scout.emitHistogram(METRIC.RN_FRAME_BUILD_TIME, delta);
                if (delta > 32)
                    droppedSinceLastReport++;
                if (delta > longTaskThresholdMs) {
                    const seconds = delta / 1000;
                    scout.emitSpan(SPAN.LONG_TASK, {
                        [ATTR.LONG_TASK_DURATION]: seconds,
                        [ATTR.LONG_TASK_THRESHOLD]: longTaskThresholdMs / 1000,
                        ...scout.commonAttributes(),
                    });
                    scout.addBreadcrumb(BREADCRUMB_TYPE.LONG_TASK, `${Math.round(delta)}ms`);
                    if (delta >= FROZEN_FRAME_MS) {
                        scout.emitSpan(SPAN.FROZEN_FRAME, {
                            [ATTR.FROZEN_FRAME_DURATION]: seconds,
                            ...scout.commonAttributes(),
                        });
                        scout.addBreadcrumb(BREADCRUMB_TYPE.FROZEN_FRAME, `${Math.round(delta)}ms`);
                    }
                }
            }
        }
        lastTs = ts;
        raf(tick);
    };
    const reportTimer = setInterval(() => {
        if (droppedSinceLastReport > 0) {
            scout.emitGauge(METRIC.RN_FRAME_DROPPED, droppedSinceLastReport);
            droppedSinceLastReport = 0;
        }
    }, 10000);
    raf(tick);
    return () => {
        stopped = true;
        clearInterval(reportTimer);
    };
}
