import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
import { uuidv4 } from '../../core/uuid';
const FROZEN_FRAME_MS = 700;
const SLOW_FRAME_MS = 16.67;
const REPORT_INTERVAL_MS = 10000;
export function installNativeFrameMetricsTracker(
  scout: Scout,
  longTaskThresholdMs: number,
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
        scout.emitHistogram(METRIC.RN_FRAME_BUILD_TIME, delta);
        if (delta > 32) droppedSinceLastReport++;
        if (delta > longTaskThresholdMs) {
          const seconds = delta / 1000;
          scout.emitSpan(SPAN.LONG_TASK, {
            [ATTR.LONG_TASK_ID]: uuidv4(),
            [ATTR.LONG_TASK_DURATION]: seconds,
            [ATTR.LONG_TASK_THRESHOLD]: longTaskThresholdMs / 1000,
            ...scout.commonAttributes(),
          });
          scout.addBreadcrumb(BREADCRUMB_TYPE.LONG_TASK, `${Math.round(delta)}ms`);
          if (delta >= FROZEN_FRAME_MS) {
            frozenMsInWindow += delta;
            scout.emitSpan(SPAN.FROZEN_FRAME, {
              [ATTR.FROZEN_FRAME_DURATION]: seconds,
              ...scout.commonAttributes(),
            });
            scout.addBreadcrumb(BREADCRUMB_TYPE.FROZEN_FRAME, `${Math.round(delta)}ms`);
          }
        }
      }
    }
    lastTs = ts;
    raf(tick);
  };
  const reportTimer = setInterval(() => {
    if (droppedSinceLastReport > 0) {
      scout.emitGauge(METRIC.RN_FRAME_DROPPED, droppedSinceLastReport);
      droppedSinceLastReport = 0;
    }
    if (frameCountWindow > 0) {
      const avgDelta = REPORT_INTERVAL_MS / frameCountWindow;
      const avgFps = 1000 / avgDelta;
      const minFps = isFinite(minDeltaInWindow) ? 1000 / minDeltaInWindow : avgFps;
      scout.emitGauge(METRIC.RN_FRAME_REFRESH_RATE, avgFps, { agg: 'average' });
      scout.emitGauge(METRIC.RN_FRAME_REFRESH_RATE, minFps, { agg: 'min' });
      scout.emitGauge(METRIC.RN_FRAME_JS_REFRESH_RATE, avgFps);
      scout.emitGauge(METRIC.RN_FRAME_SLOW_FRAMES_RATE, slowFrameMsInWindow / 10);
      scout.emitGauge(METRIC.RN_FRAME_FREEZE_RATE, (frozenMsInWindow / 1000) * 360);
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
  }, REPORT_INTERVAL_MS);
  raf(tick);
  return () => {
    stopped = true;
    clearInterval(reportTimer);
  };
}
