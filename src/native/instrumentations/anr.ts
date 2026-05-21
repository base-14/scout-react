import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
export function installNativeAnrDetector(scout: Scout, thresholdMs: number): () => void {
  const INTERVAL_MS = 1000;
  let lastBeat = Date.now();
  const id = setInterval(() => {
    const now = Date.now();
    const lag = now - lastBeat - INTERVAL_MS;
    lastBeat = now;
    if (lag > thresholdMs) {
      try {
        scout.emitSpan(SPAN.ANR, {
          [ATTR.ANR_DURATION]: lag / 1000,
          [ATTR.ANR_THRESHOLD]: thresholdMs / 1000,
          ...scout.commonAttributes(),
        });
        scout.addBreadcrumb(BREADCRUMB_TYPE.ANR, `${Math.round(lag)}ms`);
      } catch {}
    }
  }, INTERVAL_MS);
  return () => clearInterval(id);
}
