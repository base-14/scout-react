import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
export function installAnrDetector(scout: Scout, thresholdMs: number): () => void {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined') {
        return () => { };
    }
    const PING_INTERVAL_MS = 1000;
    const workerSrc = `
    let lastBeat = Date.now();
    self.onmessage = (e) => {
      if (e.data && e.data.type === 'beat') {
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
    }
    catch {
        return () => { };
    }
    worker.onmessage = (e: MessageEvent) => {
        if (e.data?.type !== 'anr')
            return;
        const duration = Number(e.data.durationMs);
        if (!Number.isFinite(duration))
            return;
        try {
            scout.emitSpan(SPAN.ANR, {
                [ATTR.ANR_DURATION]: duration / 1000,
                [ATTR.ANR_THRESHOLD]: thresholdMs / 1000,
                ...scout.commonAttributes(),
            });
            scout.addBreadcrumb(BREADCRUMB_TYPE.ANR, `${Math.round(duration)}ms`);
        }
        catch {
        }
    };
    beatTimer = setInterval(() => {
        worker?.postMessage({ type: 'beat' });
    }, PING_INTERVAL_MS);
    return () => {
        if (beatTimer)
            clearInterval(beatTimer);
        worker?.terminate();
        worker = null;
    };
}
