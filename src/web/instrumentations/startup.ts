import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
export function installStartupTracker(scout: Scout): () => void {
    if (typeof performance === 'undefined')
        return () => { };
    const emitCold = () => {
        try {
            const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
            const nav = entries[0];
            if (!nav)
                return;
            const duration = (nav.loadEventEnd || nav.domContentLoadedEventEnd) / 1000;
            scout.emitSpan(SPAN.APP_STARTUP, {
                [ATTR.APP_STARTUP_TYPE]: 'cold',
                [ATTR.APP_STARTUP_DURATION]: duration,
                ...scout.commonAttributes(),
            });
            scout.addBreadcrumb(BREADCRUMB_TYPE.STARTUP, `cold start: ${Math.round(duration * 1000)}ms`);
        }
        catch {
        }
    };
    if (typeof document !== 'undefined' && document.readyState === 'complete') {
        queueMicrotask(emitCold);
    }
    else if (typeof window !== 'undefined') {
        window.addEventListener('load', emitCold, { once: true });
    }
    const onPageShow = (e: PageTransitionEvent) => {
        if (!e.persisted)
            return;
        scout.emitSpan(SPAN.APP_STARTUP, {
            [ATTR.APP_STARTUP_TYPE]: 'warm',
            [ATTR.APP_STARTUP_DURATION]: 0,
            ...scout.commonAttributes(),
        });
        scout.addBreadcrumb(BREADCRUMB_TYPE.STARTUP, 'warm start (bfcache)');
    };
    if (typeof window !== 'undefined') {
        window.addEventListener('pageshow', onPageShow);
    }
    return () => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('pageshow', onPageShow);
        }
    };
}
