import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import type { Attributes } from '../../core/types';
import { uuidv4 } from '../../core/uuid';
export function installLongTaskTracker(scout: Scout, thresholdMs: number): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const observers: PerformanceObserver[] = [];
  const emit = (dur: number, extras: Attributes, entryType: string) => {
    const seconds = dur / 1000;
    scout.emitSpan(SPAN.LONG_TASK, {
      [ATTR.LONG_TASK_ID]: uuidv4(),
      [ATTR.LONG_TASK_DURATION]: seconds,
      [ATTR.LONG_TASK_THRESHOLD]: thresholdMs / 1000,
      [ATTR.LONG_TASK_ENTRY_TYPE]: entryType,
      ...extras,
      ...scout.commonAttributes(),
    });
    scout.addBreadcrumb(BREADCRUMB_TYPE.LONG_TASK, `${Math.round(dur)}ms`);
    if (dur >= 700) {
      scout.emitSpan(SPAN.FROZEN_FRAME, {
        [ATTR.FROZEN_FRAME_DURATION]: seconds,
        ...scout.commonAttributes(),
      });
      scout.addBreadcrumb(BREADCRUMB_TYPE.FROZEN_FRAME, `${Math.round(dur)}ms`);
    }
  };
  try {
    const o = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < thresholdMs) continue;
        emit(entry.duration, {}, 'long-task');
      }
    });
    o.observe({ type: 'longtask', buffered: true });
    observers.push(o);
  } catch {}
  try {
    const o = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        const dur: number = entry.duration ?? 0;
        if (dur < thresholdMs) continue;
        const extras: Attributes = {};
        if (typeof entry.blockingDuration === 'number') {
          extras[ATTR.LONG_TASK_BLOCKING_DURATION_MS] = entry.blockingDuration;
        }
        if (typeof entry.renderStart === 'number' && entry.renderStart > 0) {
          extras[ATTR.LONG_TASK_RENDER_START_MS] = entry.renderStart - entry.startTime;
        }
        if (
          typeof entry.styleAndLayoutStart === 'number' &&
          entry.styleAndLayoutStart > 0
        ) {
          extras[ATTR.LONG_TASK_STYLE_AND_LAYOUT_START_MS] =
            entry.styleAndLayoutStart - entry.startTime;
        }
        if (
          typeof entry.firstUIEventTimestamp === 'number' &&
          entry.firstUIEventTimestamp > 0
        ) {
          extras[ATTR.LONG_TASK_FIRST_UI_EVENT_TIMESTAMP_MS] =
            entry.firstUIEventTimestamp - entry.startTime;
        }
        if (Array.isArray(entry.scripts) && entry.scripts.length > 0) {
          try {
            extras[ATTR.LONG_TASK_SCRIPTS_JSON] = JSON.stringify(
              entry.scripts.map((s: any) => ({
                duration: s.duration,
                pause_duration: s.pauseDuration,
                forced_style_and_layout_duration: s.forcedStyleAndLayoutDuration,
                start_time: s.startTime,
                execution_start: s.executionStart,
                source_url: s.sourceURL,
                source_function_name: s.sourceFunctionName,
                source_char_position: s.sourceCharPosition,
                invoker: s.invoker,
                invoker_type: s.invokerType,
                window_attribution: s.windowAttribution,
              })),
            );
          } catch {}
        }
        emit(dur, extras, 'long-animation-frame');
      }
    });
    o.observe({ type: 'long-animation-frame', buffered: true });
    observers.push(o);
  } catch {}
  return () => {
    for (const o of observers) {
      try {
        o.disconnect();
      } catch {}
    }
  };
}
