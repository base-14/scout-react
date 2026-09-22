import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { getCurrentScreen } from './route';
/**
 * Pre-0.1.17 key. One origin can serve many tenants (a Grafana host serves
 * every tenant under its own path), so a single unscoped key let one tenant's
 * marker be read — and filed — by whichever tenant loaded next.
 */
const LEGACY_MARKER_KEY = 'scout.session-marker';
const markerKeyFor = (serviceName: string, environment?: string): string =>
  `${LEGACY_MARKER_KEY}:${serviceName}:${environment ?? ''}`;
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
  /** Identity of the session that wrote this, restored on flush. */
  serviceName?: string;
  serviceVersion?: string;
  environment?: string;
  /**
   * The writing session's own sampling decision. An unsampled session
   * exported nothing else, so a lone exit span for it is noise that also
   * escapes `sessionSampleRate`. Absent on markers written before 0.1.20,
   * which are treated as sampled once.
   */
  sampled?: boolean;
  /**
   * The last session id an `app_unclean_exit` was emitted for. A session
   * resumed within `sessionTimeoutMinutes` keeps its id, so without this a
   * kill → reopen → kill sequence reported the same session once per reopen.
   */
  reportedSessionId?: string;
}
/** `document.visibilityState`, treating a document-less runtime as visible. */
function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}
export function installCrashDetector(scout: Scout): () => void {
  if (typeof localStorage === 'undefined') return () => {};
  const { serviceName, serviceVersion, environment } = scout.config;
  const MARKER_KEY = markerKeyFor(serviceName, environment);
  try {
    // A legacy marker cannot be attributed to a tenant, so it is discarded
    // rather than guessed at — guessing is what produced the bug.
    if (localStorage.getItem(LEGACY_MARKER_KEY) !== null) {
      localStorage.removeItem(LEGACY_MARKER_KEY);
    }
  } catch {}
  let reportedSessionId: string | undefined;
  try {
    const raw = localStorage.getItem(MARKER_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as Marker;
      reportedSessionId = prev.reportedSessionId;
      const alreadyReported = prev.reportedSessionId === prev.sessionId;
      if (prev.active && prev.sampled !== false && !alreadyReported) {
        // Attribute the span to the session that actually died; the common
        // attributes describe the new one this page load created.
        const common = scout.commonAttributes();
        common[ATTR.SESSION_ID] = prev.sessionId;
        common[ATTR.SESSION_START_TIME] = prev.startedAt;
        // Otherwise the *new* page's screen rides along next to the dead
        // session's crash.last_screen, describing two different pages.
        common[ATTR.SCREEN_NAME] = prev.lastScreen;
        scout.emitSpan(
          SPAN.APP_UNCLEAN_EXIT,
          {
            [ATTR.CRASH_PREVIOUS_SESSION_ID]: prev.sessionId,
            [ATTR.CRASH_STARTED_AT]: prev.startedAt,
            // When the tab was last known alive, not when we noticed on reload.
            [ATTR.CRASH_TIMESTAMP]: prev.lastActiveAt ?? prev.startedAt,
            [ATTR.CRASH_STATUS]: 'session_marker',
            [ATTR.CRASH_LAST_SCREEN]: prev.lastScreen,
            [ATTR.CRASH_TYPE]: 'unclean_termination',
            [ATTR.CRASH_REASON]: 'tab_terminated_without_pagehide',
            [ATTR.CRASH_SERVICE_NAME]: prev.serviceName ?? serviceName,
            [ATTR.CRASH_SERVICE_VERSION]: prev.serviceVersion ?? serviceVersion,
            [ATTR.CRASH_ENVIRONMENT]: prev.environment ?? environment ?? '',
            // The dead session's trail — the live one is empty this early, and
            // would describe the wrong session anyway.
            [ATTR.BREADCRUMBS]: scout.breadcrumbsManager.serializeOrphaned() ?? '[]',
            ...common,
          },
          // This reports on a *previous* session; gating it on the current
          // session's sample decision would drop it for unrelated reasons.
          // The dead session's own decision was applied above.
          { forceSample: true },
        );
        reportedSessionId = prev.sessionId;
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
        serviceName,
        serviceVersion,
        environment,
        sampled: scout.sessionManager.isSampled,
        reportedSessionId,
      };
      localStorage.setItem(MARKER_KEY, JSON.stringify(m));
    } catch {}
  };
  // A page can be created hidden (a WebView pre-warmed by its host); it is
  // armed when it first becomes visible.
  writeMarker(isVisible());
  const onPageHide = () => writeMarker(false);
  const onBeforeUnload = () => writeMarker(false);
  // Page Lifecycle `freeze`: the browser is about to suspend the page and may
  // discard it without ever firing `pagehide`.
  const onFreeze = () => writeMarker(false);
  const onVisibility = () => writeMarker(isVisible());
  let lastScreen = getLastScreen();
  let ticksSinceWrite = 0;
  const tick = () => {
    const next = getLastScreen();
    ticksSinceWrite += 1;
    // Write on screen change, and otherwise once every ~10s to keep
    // `lastActiveAt` (the crash timestamp) current without hammering
    // localStorage every 2s. Never re-arm a hidden page: an embedded
    // WebView keeps running timers after `visibilitychange: hidden`, and
    // the host then destroys it without a `pagehide` — a routine close that
    // used to be reported as an unclean exit on the next open.
    if (next !== lastScreen || ticksSinceWrite >= HEARTBEAT_TICKS) {
      lastScreen = next;
      ticksSinceWrite = 0;
      writeMarker(isVisible());
    }
  };
  const screenInterval = setInterval(tick, TICK_MS);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('freeze', onFreeze);
  document.addEventListener('resume', onVisibility);
  return () => {
    clearInterval(screenInterval);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('freeze', onFreeze);
    document.removeEventListener('resume', onVisibility);
  };
}
function getLastScreen(): string {
  const screen = getCurrentScreen();
  if (screen) return screen;
  if (typeof location === 'undefined') return '';
  return location.pathname + (location.hash ?? '');
}
export const CRASH_BREADCRUMB = BREADCRUMB_TYPE.LIFECYCLE;
