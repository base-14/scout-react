import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
const MARKER_KEY = 'scout.session-marker';
interface Marker {
    sessionId: string;
    startedAt: string;
    lastScreen: string;
    active: boolean;
}
export function installCrashDetector(scout: Scout): () => void {
    if (typeof localStorage === 'undefined')
        return () => { };
    try {
        const raw = localStorage.getItem(MARKER_KEY);
        if (raw) {
            const prev = JSON.parse(raw) as Marker;
            if (prev.active) {
                scout.emitSpan(SPAN.APP_CRASH, {
                    [ATTR.CRASH_PREVIOUS_SESSION_ID]: prev.sessionId,
                    [ATTR.CRASH_STARTED_AT]: prev.startedAt,
                    [ATTR.CRASH_TIMESTAMP]: new Date().toISOString(),
                    [ATTR.CRASH_STATUS]: 'session_marker',
                    [ATTR.CRASH_LAST_SCREEN]: prev.lastScreen,
                    [ATTR.CRASH_TYPE]: 'unclean_termination',
                    [ATTR.CRASH_REASON]: 'tab_terminated_without_pagehide',
                    [ATTR.BREADCRUMBS]: scout.breadcrumbsManager.serialize(),
                    ...scout.commonAttributes(),
                });
            }
        }
    }
    catch {
    }
    const writeMarker = (active: boolean) => {
        try {
            const m: Marker = {
                sessionId: scout.sessionId ?? 'unknown',
                startedAt: new Date().toISOString(),
                lastScreen: getLastScreen(),
                active,
            };
            localStorage.setItem(MARKER_KEY, JSON.stringify(m));
        }
        catch {
        }
    };
    writeMarker(true);
    const onPageHide = () => writeMarker(false);
    const onBeforeUnload = () => writeMarker(false);
    const onVisibility = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            writeMarker(false);
        }
        else {
            writeMarker(true);
        }
    };
    let lastScreen = getLastScreen();
    const updateScreen = () => {
        const next = getLastScreen();
        if (next !== lastScreen) {
            lastScreen = next;
            writeMarker(true);
        }
    };
    const screenInterval = setInterval(updateScreen, 2000);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
        clearInterval(screenInterval);
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('beforeunload', onBeforeUnload);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}
function getLastScreen(): string {
    if (typeof location === 'undefined')
        return '';
    return location.pathname + (location.hash ?? '');
}
export const CRASH_BREADCRUMB = BREADCRUMB_TYPE.LIFECYCLE;
