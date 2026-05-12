import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
interface NavigationRef {
    getCurrentRoute?: () => {
        name?: string;
    } | undefined;
    addListener?: (event: string, cb: () => void) => () => void;
}
export function installNativeNavigationTracker(scout: Scout, navigationRef: NavigationRef): () => void {
    let currentScreen = navigationRef.getCurrentRoute?.()?.name ?? 'unknown';
    let enterAt = Date.now();
    const emit = (name: string) => {
        scout.emitSpan(SPAN.SCREEN_VIEW, {
            [ATTR.SCREEN_NAME]: name,
            ...scout.commonAttributes(),
        });
        scout.addBreadcrumb(BREADCRUMB_TYPE.NAVIGATION, `screen: ${name}`);
    };
    emit(currentScreen);
    if (!navigationRef.addListener)
        return () => { };
    const unsub = navigationRef.addListener('state', () => {
        const next = navigationRef.getCurrentRoute?.()?.name;
        if (!next || next === currentScreen)
            return;
        const elapsed = (Date.now() - enterAt) / 1000;
        scout.emitSpan(SPAN.VIEW_SESSION, {
            [ATTR.SCREEN_NAME]: currentScreen,
            [ATTR.VIEW_TIME_SPENT]: elapsed,
            ...scout.commonAttributes(),
        });
        currentScreen = next;
        enterAt = Date.now();
        emit(next);
    });
    return () => unsub?.();
}
