import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
import type { Attributes } from '../../core/types';
import { uuidv4 } from '../../core/uuid';
import { getCurrentScreen } from './navigation';
const FROZEN_FRAME_MS = 700;
const SLOW_FRAME_MS = 16.67;
const DEFAULT_REPORT_INTERVAL_MS = 60000;
export function installNativeFrameMetricsTracker(
  scout: Scout,
  longTaskThresholdMs: number,
  reportIntervalMs: number = DEFAULT_REPORT_INTERVAL_MS,
): () => void {
  const raf: ((cb: (t: number) => void) => number) | undefined = (globalThis as any)
    .requestAnimationFrame;
  if (typeof raf !== 'function') return () => {};
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
            frozenMsInWindow += delta;
            scout.emitSpan(SPAN.FROZEN_FRAME, {
              [ATTR.FROZEN_FRAME_DURATION]: seconds,
              ...(screen ? { [ATTR.SCREEN_NAME]: screen } : {}),
              ...scout.commonAttributes(),
            });
            scout.addBreadcrumb(
              BREADCRUMB_TYPE.FROZEN_FRAME,
              `Frozen frame: ${Math.round(delta)}ms`,
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
  return () => {
    stopped = true;
    clearInterval(reportTimer);
  };
}
