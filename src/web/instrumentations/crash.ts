import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { getCurrentScreen } from './route';
const MARKER_KEY = 'scout.session-marker';
const TICK_MS = 2000;
/** 5 ticks × 2s = refresh `lastActiveAt` at least every 10s. */
const HEARTBEAT_TICKS = 5;
interface Marker {
  sessionId: string;
  startedAt: string;
  lastScreen: string;
  active: boolean;
  /** Wall-clock of the last time the tab was known to be alive. */
  lastActiveAt?: string;
}
export function installCrashDetector(scout: Scout): () => void {
  if (typeof localStorage === 'undefined') return () => {};
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as Marker;
      if (prev.active) {
        // Attribute the span to the session that actually died; the common
        // attributes describe the new one this page load created.
        const common = scout.commonAttributes();
        common[ATTR.SESSION_ID] = prev.sessionId;
        common[ATTR.SESSION_START_TIME] = prev.startedAt;
        scout.emitSpan(SPAN.APP_CRASH, {
          [ATTR.CRASH_PREVIOUS_SESSION_ID]: prev.sessionId,
          [ATTR.CRASH_STARTED_AT]: prev.startedAt,
          // When the tab was last known alive, not when we noticed on reload.
          [ATTR.CRASH_TIMESTAMP]: prev.lastActiveAt ?? prev.startedAt,
          [ATTR.CRASH_STATUS]: 'session_marker',
          [ATTR.CRASH_LAST_SCREEN]: prev.lastScreen,
          [ATTR.CRASH_TYPE]: 'unclean_termination',
          [ATTR.CRASH_REASON]: 'tab_terminated_without_pagehide',
          // The dead session's trail — the live one is empty this early, and
          // would describe the wrong session anyway.
          [ATTR.BREADCRUMBS]: scout.breadcrumbsManager.serializeOrphaned() ?? '[]',
          ...common,
        });
      }
    }
  } catch {}
  const writeMarker = (active: boolean) => {
    try {
      const m: Marker = {
        sessionId: scout.sessionId ?? 'unknown',
        // The session's own start, not "now" — this value is reported as the
        // crashed session's session.start_time.
        startedAt: scout.sessionManager.startedAtIso ?? new Date().toISOString(),
        lastScreen: getLastScreen(),
        active,
        lastActiveAt: new Date().toISOString(),
      };
      localStorage.setItem(MARKER_KEY, JSON.stringify(m));
    } catch {}
  };
  writeMarker(true);
  const onPageHide = () => writeMarker(false);
  const onBeforeUnload = () => writeMarker(false);
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      writeMarker(false);
    } else {
      writeMarker(true);
    }
  };
  let lastScreen = getLastScreen();
  let ticksSinceWrite = 0;
  const tick = () => {
    const next = getLastScreen();
    ticksSinceWrite += 1;
    // Write on screen change, and otherwise once every ~10s to keep
    // `lastActiveAt` (the crash timestamp) current without hammering
    // localStorage every 2s.
    if (next !== lastScreen || ticksSinceWrite >= HEARTBEAT_TICKS) {
      lastScreen = next;
      ticksSinceWrite = 0;
      writeMarker(true);
    }
  };
  const screenInterval = setInterval(tick, TICK_MS);
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
  const screen = getCurrentScreen();
  if (screen) return screen;
  if (typeof location === 'undefined') return '';
  return location.pathname + (location.hash ?? '');
}
export const CRASH_BREADCRUMB = BREADCRUMB_TYPE.LIFECYCLE;
