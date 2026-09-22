import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
import type { Attributes } from '../../core/types';
import { uuidv4 } from '../../core/uuid';
import { getCurrentScreen } from './navigation';
import { withSuppression } from '../soft-load';
const FROZEN_FRAME_MS = 700;
const DEFAULT_FROZEN_FRAME_MAX_MS = 10000;
const SLOW_FRAME_MS = 16.67;
const DEFAULT_REPORT_INTERVAL_MS = 60000;
/** The slice of React Native's AppState this tracker needs; injectable for tests. */
export interface AppStateLike {
  currentState: string;
  addEventListener(
    type: 'change',
    handler: (state: string) => void,
  ): { remove?: () => void } | void;
  removeEventListener?(type: 'change', handler: (state: string) => void): void;
}
export interface NativeFrameMetricsOptions {
  /** Cap for `frozen_frame.duration`; longer gaps are reported at the cap, flagged. */
  frozenFrameMaxMs?: number;
  appState?: AppStateLike | null;
}
let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}
export function installNativeFrameMetricsTracker(
  scout: Scout,
  longTaskThresholdMs: number,
  reportIntervalMs: number = DEFAULT_REPORT_INTERVAL_MS,
  opts: NativeFrameMetricsOptions = {},
): () => void {
  const raf: ((cb: (t: number) => void) => number) | undefined = (globalThis as any)
    .requestAnimationFrame;
  if (typeof raf !== 'function') return () => {};
  const frozenFrameMaxMs = Math.max(
    FROZEN_FRAME_MS,
    opts.frozenFrameMaxMs ?? DEFAULT_FROZEN_FRAME_MAX_MS,
  );
  const AppState: AppStateLike | null =
    opts.appState !== undefined ? opts.appState : (RN?.AppState ?? null);
  // A frame gap that spans time in the background is the OS pausing the app,
  // not the JS thread being blocked: rAF stops while backgrounded, so the
  // first frame after resume used to arrive as one gap the length of the
  // whole background stay and was reported as a frozen frame that long.
  let foreground = AppState ? AppState.currentState !== 'background' : true;
  let lastTs = -1;
  let stopped = false;
  let droppedSinceLastReport = 0;
  let frameCountWindow = 0;
  let minDeltaInWindow = Number.POSITIVE_INFINITY;
  let slowFrameMsInWindow = 0;
  let frozenMsInWindow = 0;
  const slowFramesList: Array<{
    start: number;
    duration: number;
  }> = [];
  const viewStartedAt = performance.now();
  let currentRoot: unknown = scout.rootSpan;
  const tick = (ts: number) => {
    if (stopped) return;
    if (!foreground) {
      // Do not measure across a background stay; the next foreground frame
      // starts a fresh baseline.
      lastTs = -1;
      raf(tick);
      return;
    }
    if (lastTs >= 0) {
      const delta = ts - lastTs;
      frameCountWindow++;
      if (delta < minDeltaInWindow) minDeltaInWindow = delta;
      if (delta > SLOW_FRAME_MS) {
        slowFrameMsInWindow += delta - SLOW_FRAME_MS;
        if (scout.rootSpan === currentRoot) {
          if (slowFramesList.length < 200) {
            slowFramesList.push({
              start: Math.round(ts - viewStartedAt - delta),
              duration: Math.round(delta),
            });
          }
        } else {
          currentRoot = scout.rootSpan;
          slowFramesList.length = 0;
        }
      }
      if (delta > 50) {
        const histScreen = getCurrentScreen();
        scout.emitHistogram(
          METRIC.RN_FRAME_BUILD_TIME,
          delta,
          histScreen ? { [ATTR.SCREEN_NAME]: histScreen } : {},
        );
        if (delta > 32) droppedSinceLastReport++;
        if (delta > longTaskThresholdMs) {
          const seconds = delta / 1000;
          const screen = getCurrentScreen();
          scout.emitSpan(SPAN.LONG_TASK, {
            [ATTR.LONG_TASK_ID]: uuidv4(),
            [ATTR.LONG_TASK_DURATION]: seconds,
            [ATTR.LONG_TASK_THRESHOLD]: longTaskThresholdMs / 1000,
            ...(screen ? { [ATTR.SCREEN_NAME]: screen } : {}),
            ...scout.commonAttributes(),
          });
          scout.addBreadcrumb(
            BREADCRUMB_TYPE.LONG_TASK,
            `Long task: ${Math.round(delta)}ms`,
          );
          if (delta >= FROZEN_FRAME_MS) {
            const capped = delta > frozenFrameMaxMs;
            const frozenMs = capped ? frozenFrameMaxMs : delta;
            frozenMsInWindow += frozenMs;
            scout.emitSpan(SPAN.FROZEN_FRAME, {
              [ATTR.FROZEN_FRAME_DURATION]: frozenMs / 1000,
              ...(capped ? { [ATTR.FROZEN_FRAME_CAPPED]: true } : {}),
              ...(screen ? { [ATTR.SCREEN_NAME]: screen } : {}),
              ...scout.commonAttributes(),
            });
            scout.addBreadcrumb(
              BREADCRUMB_TYPE.FROZEN_FRAME,
              `Frozen frame: ${Math.round(frozenMs)}ms`,
            );
          }
        }
      }
    }
    lastTs = ts;
    raf(tick);
  };
  const reportTimer = setInterval(() => {
    const reportScreen = getCurrentScreen();
    const screenAttr: Attributes = reportScreen
      ? { [ATTR.SCREEN_NAME]: reportScreen }
      : {};
    if (droppedSinceLastReport > 0) {
      scout.emitGauge(METRIC.RN_FRAME_DROPPED, droppedSinceLastReport, screenAttr);
      droppedSinceLastReport = 0;
    }
    if (frameCountWindow > 0) {
      const avgDelta = reportIntervalMs / frameCountWindow;
      const avgFps = 1000 / avgDelta;
      const minFps = isFinite(minDeltaInWindow) ? 1000 / minDeltaInWindow : avgFps;
      scout.emitGauge(METRIC.RN_FRAME_REFRESH_RATE, avgFps, {
        agg: 'average',
        ...screenAttr,
      });
      scout.emitGauge(METRIC.RN_FRAME_REFRESH_RATE, minFps, {
        agg: 'min',
        ...screenAttr,
      });
      scout.emitGauge(METRIC.RN_FRAME_JS_REFRESH_RATE, avgFps, screenAttr);
      scout.emitGauge(
        METRIC.RN_FRAME_SLOW_FRAMES_RATE,
        slowFrameMsInWindow / 10,
        screenAttr,
      );
      scout.emitGauge(
        METRIC.RN_FRAME_FREEZE_RATE,
        (frozenMsInWindow / 1000) * 360,
        screenAttr,
      );
    }
    try {
      const root = scout.rootSpan;
      if (root && slowFramesList.length > 0) {
        root.setAttribute(
          ATTR.VIEW_SLOW_FRAMES_JSON,
          JSON.stringify(slowFramesList).slice(0, 8000),
        );
      }
    } catch {}
    frameCountWindow = 0;
    minDeltaInWindow = Number.POSITIVE_INFINITY;
    slowFrameMsInWindow = 0;
    frozenMsInWindow = 0;
  }, reportIntervalMs);
  raf(tick);
  const onAppState = (state: string) => {
    foreground = state === 'active';
    // Whatever gap the pause produced belongs to the pause, not to a frame.
    lastTs = -1;
  };
  let sub: { remove?: () => void } | void;
  try {
    sub = AppState?.addEventListener('change', onAppState);
  } catch {}
  return () => {
    stopped = true;
    clearInterval(reportTimer);
    try {
      if (sub && typeof sub.remove === 'function') sub.remove();
      else AppState?.removeEventListener?.('change', onAppState);
    } catch {}
  };
}
