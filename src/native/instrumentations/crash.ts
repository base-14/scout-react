import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
const MARKER_KEY = 'scout.session-marker';
/**
 * How often the marker is refreshed while the app is foregrounded. The crash
 * timestamp can only be as precise as the last refresh, so this bounds
 * `crash.timestamp` error to ~30s — matched to the export interval to keep
 * the write rate in line with the SDK's other periodic work.
 */
const HEARTBEAT_MS = 30000;
interface Marker {
  sessionId: string;
  startedAt: string;
  lastScreen: string;
  active: boolean;
  /** Wall-clock of the last time the app was known to be alive. */
  lastActiveAt?: string;
  /**
   * The writing session's own sampling decision; an unsampled session
   * exported nothing else. Absent before 0.1.20 — treated as sampled once.
   */
  sampled?: boolean;
  /**
   * Last session id an `app_unclean_exit` was emitted for. A session resumed
   * within `sessionTimeoutMinutes` keeps its id, so this stops one dead
   * session being reported once per relaunch.
   */
  reportedSessionId?: string;
}
let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}
export async function installNativeCrashDetector(scout: Scout): Promise<() => void> {
  const platform = scout.platformAdapter;
  let reportedSessionId: string | undefined;
  try {
    const raw = await platform.getItem(MARKER_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as Marker;
      reportedSessionId = prev.reportedSessionId;
      const alreadyReported = prev.reportedSessionId === prev.sessionId;
      if (prev.active && prev.sampled !== false && !alreadyReported) {
        // The span describes the *crashed* session, so it must be attributed
        // to it — the common attributes carry the new session that started
        // when the app relaunched. Same rewrite native-crash.ts does for NDK
        // reports.
        const common = scout.commonAttributes();
        common[ATTR.SESSION_ID] = prev.sessionId;
        common[ATTR.SESSION_START_TIME] = prev.startedAt;
        scout.emitSpan(
          SPAN.APP_UNCLEAN_EXIT,
          {
            [ATTR.CRASH_PREVIOUS_SESSION_ID]: prev.sessionId,
            [ATTR.CRASH_STARTED_AT]: prev.startedAt,
            // When the app was last known alive, not when we noticed on relaunch.
            [ATTR.CRASH_TIMESTAMP]: prev.lastActiveAt ?? prev.startedAt,
            [ATTR.CRASH_STATUS]: 'session_marker',
            [ATTR.CRASH_LAST_SCREEN]:
              prev.lastScreen ||
              lastScreenFromBreadcrumbs(scout.breadcrumbsManager.orphaned()),
            [ATTR.CRASH_TYPE]: 'unclean_termination',
            // The dead session's trail — the live one is empty this early, and
            // would describe the wrong session anyway.
            [ATTR.BREADCRUMBS]: scout.breadcrumbsManager.serializeOrphaned() ?? '[]',
            ...common,
          },
          // Reports on a *previous* session, so the current session's sample
          // decision must not gate it; the dead session's own decision was
          // applied above. Not an error-class span, so no other bypass.
          { forceSample: true },
        );
        reportedSessionId = prev.sessionId;
      }
    }
  } catch {}
  const writeMarker = async (active: boolean) => {
    try {
      await platform.setItem(
        MARKER_KEY,
        JSON.stringify({
          sessionId: scout.sessionId ?? 'unknown',
          startedAt: scout.sessionManager.startedAtIso ?? new Date().toISOString(),
          lastScreen: lastScreenFromBreadcrumbs(scout.breadcrumbsManager.list()),
          active,
          lastActiveAt: new Date().toISOString(),
          sampled: scout.sessionManager.isSampled,
          reportedSessionId,
        } satisfies Marker),
      );
    } catch {}
  };
  const AppState = RN?.AppState;
  // Android keeps JS timers running for a while after the app is backgrounded,
  // so the heartbeat must write the *current* state, never a blanket `true`,
  // or a background kill would be re-armed as an unclean exit.
  let foreground = AppState ? AppState.currentState !== 'background' : true;
  await writeMarker(foreground);
  // Refresh while foregrounded so a crash timestamp is close to the real
  // death time rather than to whenever the app last changed state.
  const heartbeat = setInterval(() => {
    void writeMarker(foreground);
  }, HEARTBEAT_MS);
  if (!AppState) return () => clearInterval(heartbeat);
  const onChange = (state: string) => {
    foreground = state === 'active';
    void writeMarker(foreground);
  };
  const sub = AppState.addEventListener('change', onChange);
  return () => {
    clearInterval(heartbeat);
    try {
      if (typeof sub?.remove === 'function') sub.remove();
      else AppState.removeEventListener?.('change', onChange);
    } catch {}
  };
}
function lastScreenFromBreadcrumbs(
  crumbs: Array<{ type?: string; message?: string }>,
): string {
  try {
    for (let i = crumbs.length - 1; i >= 0; i--) {
      const c = crumbs[i];
      if (c?.type === 'navigation' && typeof c.message === 'string') {
        const m = c.message.match(/screen:\s*(.+)/);
        if (m && m[1]) return m[1];
      }
    }
  } catch {}
  return '';
}
