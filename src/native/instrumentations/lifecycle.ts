import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
let RN: any = null;
try {
    RN = withSuppression(() => require('react-native'));
}
catch {
}
export function installNativeLifecycleTracker(scout: Scout): () => void {
    const AppState = RN?.AppState;
    if (!AppState)
        return () => { };
    let last: string = AppState.currentState;
    const onChange = (state: string) => {
        try {
            if (last === 'active' && (state === 'background' || state === 'inactive')) {
                scout.emitSpan(SPAN.APP_PAUSED, scout.commonAttributes());
                scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'paused');
            }
            else if (last !== 'active' && state === 'active') {
                void scout.sessionManager.maybeRotateOnResume().then(() => {
                    scout.emitSpan(SPAN.APP_RESUMED, scout.commonAttributes());
                    scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'resumed');
                });
            }
            last = state;
        }
        catch {
        }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => {
        try {
            if (typeof sub?.remove === 'function')
                sub.remove();
            else
                AppState.removeEventListener?.('change', onChange);
        }
        catch {
        }
    };
}
