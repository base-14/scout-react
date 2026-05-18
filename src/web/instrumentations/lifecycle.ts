import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
export function installLifecycleTracker(scout: Scout, onBackgroundFlush?: () => void | Promise<void>): () => void {
    if (typeof document === 'undefined')
        return () => { };
    let currentRoot: unknown = scout.rootSpan;
    let viewStart = performance.now();
    let foregroundStart: number | null = document.visibilityState === 'visible' ? 0 : null;
    let periods: Array<{
        start: number;
        duration: number;
    }> = [];
    const flushPeriods = () => {
        const span = scout.rootSpan;
        if (!span)
            return;
        if (span !== currentRoot) {
            currentRoot = span;
            viewStart = performance.now();
            periods = [];
            foregroundStart = document.visibilityState === 'visible' ? 0 : null;
        }
        try {
            span.setAttribute(ATTR.VIEW_IN_FOREGROUND_PERIODS_JSON, JSON.stringify(periods));
        }
        catch {
        }
    };
    const onVisibilityChange = () => {
        try {
            if (document.visibilityState === 'hidden') {
                scout.emitSpan(SPAN.APP_PAUSED, scout.commonAttributes());
                scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'paused');
                if (foregroundStart != null) {
                    periods.push({
                        start: Math.round(foregroundStart),
                        duration: Math.round(performance.now() - viewStart - foregroundStart),
                    });
                    foregroundStart = null;
                    flushPeriods();
                }
                try {
                    void onBackgroundFlush?.();
                }
                catch {
                }
            }
            else if (document.visibilityState === 'visible') {
                void scout.sessionManager.maybeRotateOnResume().then(() => {
                    scout.emitSpan(SPAN.APP_RESUMED, scout.commonAttributes());
                    scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'resumed');
                    foregroundStart = performance.now() - viewStart;
                });
            }
        }
        catch {
        }
    };
    const onPageHide = () => {
        try {
            scout.emitSpan(SPAN.APP_PAUSED, {
                ...scout.commonAttributes(),
                [ATTR.ERROR_HANDLED]: 'true',
            });
            try {
                void onBackgroundFlush?.();
            }
            catch {
            }
        }
        catch {
        }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', onPageHide);
    };
}
