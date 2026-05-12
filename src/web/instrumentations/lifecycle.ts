import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
export function installLifecycleTracker(scout: Scout): () => void {
    if (typeof document === 'undefined')
        return () => { };
    const onVisibilityChange = () => {
        try {
            if (document.visibilityState === 'hidden') {
                scout.emitSpan(SPAN.APP_PAUSED, scout.commonAttributes());
                scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'paused');
            }
            else if (document.visibilityState === 'visible') {
                void scout.sessionManager.maybeRotateOnResume().then(() => {
                    scout.emitSpan(SPAN.APP_RESUMED, scout.commonAttributes());
                    scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'resumed');
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
