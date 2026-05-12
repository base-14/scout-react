import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
const MARKER_KEY = 'scout.session-marker';
interface Marker {
    sessionId: string;
    startedAt: string;
    lastScreen: string;
    active: boolean;
}
let RN: any = null;
try {
    RN = withSuppression(() => require('react-native'));
}
catch {
}
export async function installNativeCrashDetector(scout: Scout): Promise<() => void> {
    const platform = scout.platformAdapter;
    try {
        const raw = await platform.getItem(MARKER_KEY);
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
                    [ATTR.BREADCRUMBS]: scout.breadcrumbsManager.serialize(),
                    ...scout.commonAttributes(),
                });
            }
        }
    }
    catch {
    }
    const writeMarker = async (active: boolean) => {
        try {
            await platform.setItem(MARKER_KEY, JSON.stringify({
                sessionId: scout.sessionId ?? 'unknown',
                startedAt: new Date().toISOString(),
                lastScreen: '',
                active,
            } satisfies Marker));
        }
        catch {
        }
    };
    await writeMarker(true);
    const AppState = RN?.AppState;
    if (!AppState)
        return () => { };
    const onChange = (state: string) => {
        void writeMarker(state === 'active');
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
