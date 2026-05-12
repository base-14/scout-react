import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
export function installLongTaskTracker(scout: Scout, thresholdMs: number): () => void {
    if (typeof PerformanceObserver === 'undefined')
        return () => { };
    let observer: PerformanceObserver | null = null;
    try {
        observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const dur = entry.duration;
                if (dur < thresholdMs)
                    continue;
                const seconds = dur / 1000;
                scout.emitSpan(SPAN.LONG_TASK, {
                    [ATTR.LONG_TASK_DURATION]: seconds,
                    [ATTR.LONG_TASK_THRESHOLD]: thresholdMs / 1000,
                    ...scout.commonAttributes(),
                });
                scout.addBreadcrumb(BREADCRUMB_TYPE.LONG_TASK, `${Math.round(dur)}ms`);
                if (dur >= 700) {
                    scout.emitSpan(SPAN.FROZEN_FRAME, {
                        [ATTR.FROZEN_FRAME_DURATION]: seconds,
                        ...scout.commonAttributes(),
                    });
                    scout.addBreadcrumb(BREADCRUMB_TYPE.FROZEN_FRAME, `${Math.round(dur)}ms`);
                }
            }
        });
        observer.observe({ type: 'longtask', buffered: true });
    }
    catch {
        return () => { };
    }
    return () => {
        try {
            observer?.disconnect();
        }
        catch {
        }
    };
}
