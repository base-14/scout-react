import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
export function installAnrDetector(scout: Scout, thresholdMs: number): () => void {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') {
    return () => {};
  }
  const PING_INTERVAL_MS = 1000;
  // The worker measures how late the main thread's beat arrives. That is a
  // faithful measure of main-thread lateness — but a hidden tab's timers are
  // clamped to roughly once a minute, and throttling is indistinguishable from
  // blocking from in here. The main thread stops beating while hidden and
  // sends `reset` before it resumes, so the worker never sees a throttled gap.
  const workerSrc = `
    let lastBeat = Date.now();
    self.onmessage = (e) => {
      if (!e.data) return;
      if (e.data.type === 'reset') {
        lastBeat = Date.now();
        return;
      }
      if (e.data.type === 'beat') {
        const now = Date.now();
        const lag = now - lastBeat - ${PING_INTERVAL_MS};
        lastBeat = now;
        if (lag > ${thresholdMs}) {
          self.postMessage({ type: 'anr', durationMs: lag });
        }
      }
    };
  `;
  let worker: Worker | null = null;
  let beatTimer: ReturnType<typeof setInterval> | null = null;
  try {
    const blob = new Blob([workerSrc], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);
    URL.revokeObjectURL(url);
  } catch {
    return () => {};
  }
  const visibilityState = (): string =>
    typeof document === 'undefined' ? 'unknown' : (document.visibilityState ?? 'unknown');
  const isVisible = (): boolean => visibilityState() !== 'hidden';
  worker.onmessage = (e: MessageEvent) => {
    if (e.data?.type !== 'anr') return;
    const duration = Number(e.data.durationMs);
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      // A span's duration is the right home for how long the hang lasted.
      // Emitting it as a zero-duration marker hid the value from the waterfall
      // and from every generic p95-over-Duration consumer.
      const endTime = Date.now();
      scout.emitSpan(
        SPAN.ANR,
        {
          [ATTR.ANR_DURATION_MS]: duration,
          [ATTR.ANR_THRESHOLD_MS]: thresholdMs,
          [ATTR.ANR_VISIBILITY_STATE]: visibilityState(),
          ...scout.commonAttributes(),
        },
        { startTime: endTime - duration, endTime },
      );
      scout.addBreadcrumb(BREADCRUMB_TYPE.ANR, `${Math.round(duration)}ms`);
    } catch {}
  };
  const startBeating = () => {
    if (beatTimer) return;
    beatTimer = setInterval(() => {
      worker?.postMessage({ type: 'beat' });
    }, PING_INTERVAL_MS);
  };
  const stopBeating = () => {
    if (!beatTimer) return;
    clearInterval(beatTimer);
    beatTimer = null;
  };
  const onVisibility = () => {
    if (isVisible()) {
      // Discard the gap we just spent hidden before the next beat charges it
      // as a hang — that is what produced an `anr` 16ms after `resumed`.
      worker?.postMessage({ type: 'reset' });
      startBeating();
    } else {
      stopBeating();
    }
  };
  // A tab can be opened in the background; don't start beating until it shows.
  if (isVisible()) startBeating();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }
  return () => {
    stopBeating();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
    worker?.terminate();
    worker = null;
  };
}
