import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import type { Attributes } from '../../core/types';
import { uuidv4 } from '../../core/uuid';
import { getCurrentScreen } from './route';
const FROZEN_FRAME_MS = 700;
const DEFAULT_FROZEN_FRAME_MAX_MS = 10000;
/** Hidden intervals older than this cannot overlap an entry still in flight. */
const HIDDEN_HISTORY_MS = 5 * 60 * 1000;
export interface LongTaskOptions {
  /** Cap for `frozen_frame.duration`; longer frames are reported at the cap, flagged. */
  frozenFrameMaxMs?: number;
}
function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
export function installLongTaskTracker(
  scout: Scout,
  thresholdMs: number,
  opts: LongTaskOptions = {},
): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const frozenFrameMaxMs = Math.max(
    FROZEN_FRAME_MS,
    opts.frozenFrameMaxMs ?? DEFAULT_FROZEN_FRAME_MAX_MS,
  );
  const observers: PerformanceObserver[] = [];
  const installedAt = now();
  // Time spent hidden is not the main thread being blocked. A hidden tab's
  // tasks are throttled rather than stretched, but an embedded WebView whose
  // host suspends the renderer mid-task reports a single task spanning the
  // whole suspension when it resumes — 25 s "frozen frames" that were the
  // user switching apps. Entries overlapping a hidden interval are dropped.
  const hidden: Array<{ from: number; to: number }> = [];
  let hiddenSince: number | null = isVisible() ? null : now();
  const markHidden = () => {
    if (hiddenSince == null) hiddenSince = now();
  };
  const markVisible = () => {
    if (hiddenSince == null) return;
    hidden.push({ from: hiddenSince, to: now() });
    hiddenSince = null;
    const cutoff = now() - HIDDEN_HISTORY_MS;
    while (hidden.length > 0 && hidden[0]!.to < cutoff) hidden.shift();
  };
  const onVisibility = () => (isVisible() ? markVisible() : markHidden());
  const overlapsHidden = (start: number, end: number): boolean => {
    if (hiddenSince != null && end > hiddenSince) return true;
    for (const h of hidden) if (start < h.to && end > h.from) return true;
    return false;
  };
  const emit = (entry: PerformanceEntry, extras: Attributes, entryType: string) => {
    const dur = entry.duration ?? 0;
    if (dur < thresholdMs) return;
    const start = entry.startTime ?? now();
    const end = start + dur;
    // `buffered: true` replays entries from before the SDK was installed,
    // including one that straddled a pre-init suspension.
    if (end < installedAt) return;
    if (overlapsHidden(start, end)) return;
    const seconds = dur / 1000;
    const screen = getCurrentScreen();
    scout.emitSpan(SPAN.LONG_TASK, {
      [ATTR.LONG_TASK_ID]: uuidv4(),
      [ATTR.LONG_TASK_DURATION]: seconds,
      [ATTR.LONG_TASK_THRESHOLD]: thresholdMs / 1000,
      [ATTR.LONG_TASK_ENTRY_TYPE]: entryType,
      ...(screen ? { [ATTR.SCREEN_NAME]: screen } : {}),
      ...extras,
      ...scout.commonAttributes(),
    });
    scout.addBreadcrumb(BREADCRUMB_TYPE.LONG_TASK, `${Math.round(dur)}ms`);
    if (dur >= FROZEN_FRAME_MS) {
      const capped = dur > frozenFrameMaxMs;
      const frozenMs = capped ? frozenFrameMaxMs : dur;
      scout.emitSpan(SPAN.FROZEN_FRAME, {
        [ATTR.FROZEN_FRAME_DURATION]: frozenMs / 1000,
        ...(capped ? { [ATTR.FROZEN_FRAME_CAPPED]: true } : {}),
        ...(screen ? { [ATTR.SCREEN_NAME]: screen } : {}),
        ...scout.commonAttributes(),
      });
      scout.addBreadcrumb(BREADCRUMB_TYPE.FROZEN_FRAME, `${Math.round(frozenMs)}ms`);
    }
  };
  // Long Animation Frames (Chrome 123+) describe the same stalls as `longtask`
  // entries with script attribution on top. Observing both reported one stall
  // twice, so where LoAF exists it is the only source.
  const supported: readonly string[] =
    (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] })
      .supportedEntryTypes ?? [];
  const hasLoaf = supported.includes('long-animation-frame');
  if (!hasLoaf) {
    try {
      const o = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) emit(entry, {}, 'long-task');
      });
      o.observe({ type: 'longtask', buffered: true });
      observers.push(o);
    } catch {}
  }
  try {
    const o = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
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
        emit(entry, extras, 'long-animation-frame');
      }
    });
    o.observe({ type: 'long-animation-frame', buffered: true });
    observers.push(o);
  } catch {}
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('freeze', markHidden);
    document.addEventListener('resume', onVisibility);
  }
  return () => {
    for (const o of observers) {
      try {
        o.disconnect();
      } catch {}
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('freeze', markHidden);
      document.removeEventListener('resume', onVisibility);
    }
  };
}
