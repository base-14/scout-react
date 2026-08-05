import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
import type { Attributes } from '../../core/types';
const NAME_TO_METRIC: Record<string, string> = {
  CLS: METRIC.WEB_VITAL_CLS,
  FCP: METRIC.WEB_VITAL_FCP,
  INP: METRIC.WEB_VITAL_INP,
  LCP: METRIC.WEB_VITAL_LCP,
  TTFB: METRIC.WEB_VITAL_TTFB,
};
function selectorOf(el: unknown): string | undefined {
  if (!el || typeof el !== 'object') return undefined;
  const node = el as Element;
  if (!node.tagName) return undefined;
  const parts: string[] = [];
  let cur: Element | null = node;
  let depth = 0;
  while (cur && depth < 10) {
    const id = cur.id ? `#${cur.id}` : '';
    const cls =
      cur.className && typeof cur.className === 'string'
        ? `.${cur.className.split(/\s+/).filter(Boolean).join('.')}`
        : '';
    parts.unshift(`${cur.tagName.toLowerCase()}${id}${cls}`);
    if (cur.id) break;
    cur = cur.parentElement;
    depth++;
  }
  return parts.join('>');
}
function extractCLS(m: Metric): Attributes {
  const out: Attributes = {};
  for (const e of m.entries as any[]) {
    if (!e?.sources?.length) continue;
    for (const src of e.sources) {
      if (src.node) {
        const sel = selectorOf(src.node);
        if (sel) out[ATTR.WEB_VITAL_TARGET_SELECTOR] = sel;
      }
      const prev = src.previousRect;
      const curr = src.currentRect;
      if (prev) {
        out[ATTR.WEB_VITAL_CLS_PREVIOUS_RECT_X] = prev.x;
        out[ATTR.WEB_VITAL_CLS_PREVIOUS_RECT_Y] = prev.y;
        out[ATTR.WEB_VITAL_CLS_PREVIOUS_RECT_WIDTH] = prev.width;
        out[ATTR.WEB_VITAL_CLS_PREVIOUS_RECT_HEIGHT] = prev.height;
      }
      if (curr) {
        out[ATTR.WEB_VITAL_CLS_CURRENT_RECT_X] = curr.x;
        out[ATTR.WEB_VITAL_CLS_CURRENT_RECT_Y] = curr.y;
        out[ATTR.WEB_VITAL_CLS_CURRENT_RECT_WIDTH] = curr.width;
        out[ATTR.WEB_VITAL_CLS_CURRENT_RECT_HEIGHT] = curr.height;
      }
      return out;
    }
  }
  return out;
}
function extractINP(m: Metric): Attributes {
  const out: Attributes = {};
  for (const e of m.entries as any[]) {
    if (typeof e?.processingStart !== 'number') continue;
    const inputDelay = e.processingStart - e.startTime;
    const processing = e.processingEnd - e.processingStart;
    const presentation = e.startTime + e.duration - e.processingEnd;
    out[ATTR.WEB_VITAL_INP_INPUT_DELAY_MS] = inputDelay;
    out[ATTR.WEB_VITAL_INP_PROCESSING_DURATION_MS] = processing;
    out[ATTR.WEB_VITAL_INP_PRESENTATION_DELAY_MS] = presentation;
    if (e.target) {
      const sel = selectorOf(e.target);
      if (sel) out[ATTR.WEB_VITAL_TARGET_SELECTOR] = sel;
    }
    break;
  }
  return out;
}
function extractLCP(m: Metric): Attributes {
  const out: Attributes = {};
  for (const e of m.entries as any[]) {
    if (!e) continue;
    if (e.element) {
      const sel = selectorOf(e.element);
      if (sel) out[ATTR.WEB_VITAL_TARGET_SELECTOR] = sel;
    }
    if (typeof e.url === 'string' && e.url) {
      out[ATTR.WEB_VITAL_LCP_RESOURCE_URL] = e.url;
    }
    const url = e.url as string | undefined;
    if (url) {
      const res = performance
        .getEntriesByName(url)
        .filter((x) => x.entryType === 'resource')[0] as
        | PerformanceResourceTiming
        | undefined;
      if (res) {
        const ttfb = res.startTime;
        out[ATTR.WEB_VITAL_LCP_LOAD_DELAY_MS] = res.requestStart - ttfb;
        out[ATTR.WEB_VITAL_LCP_LOAD_TIME_MS] = res.responseEnd - res.requestStart;
        out[ATTR.WEB_VITAL_LCP_RENDER_DELAY_MS] = e.startTime - res.responseEnd;
      }
    }
    break;
  }
  return out;
}
// `web-vitals` registers PerformanceObservers that live as long as the document
// — `onCLS(cb)` has no unsubscribe. So the callbacks are registered once and
// permanently, and this holds whichever Scout should receive them. A host that
// mounts the SDK repeatedly would otherwise stack one live closure per mount,
// each reporting the same vital again against a provider that may already have
// been shut down.
let activeScout: Scout | null = null;
let observersRegistered = false;

/** Test-only: drops the registration latch and the active instance. */
export function __resetWebVitalsStateForTests(): void {
  activeScout = null;
  observersRegistered = false;
}

export function installWebVitalsTracker(scout: Scout): () => void {
  activeScout = scout;
  const send = (m: Metric) => {
    const target = activeScout;
    if (!target) return;
    try {
      const metricName = NAME_TO_METRIC[m.name] ?? `web.vital.${m.name.toLowerCase()}`;
      const base: Attributes = {
        [ATTR.WEB_VITAL_NAME]: m.name,
        [ATTR.WEB_VITAL_VALUE]: m.value,
        [ATTR.WEB_VITAL_RATING]: m.rating,
        [ATTR.WEB_VITAL_ID]: m.id,
      };
      let extras: Attributes = {};
      if (m.name === 'CLS') extras = extractCLS(m);
      else if (m.name === 'INP') extras = extractINP(m);
      else if (m.name === 'LCP') extras = extractLCP(m);
      target.emitHistogram(metricName, m.value, { ...base, ...extras });
      target.emitSpan(SPAN.WEB_VITAL, {
        ...base,
        ...extras,
        ...target.commonAttributes(),
      });
      try {
        const root = target.rootSpan;
        if (root) {
          const prefix = `web.vital.${m.name.toLowerCase()}`;
          const screenAttrs: Record<string, any> = { [`${prefix}.value`]: m.value };
          if (m.rating) screenAttrs[`${prefix}.rating`] = m.rating;
          for (const [k, v] of Object.entries(extras)) {
            screenAttrs[k] = v;
          }
          const clean: Record<string, any> = {};
          for (const [k, v] of Object.entries(screenAttrs)) {
            if (v != null) clean[k] = v;
          }
          root.setAttributes(clean);
        }
      } catch {}
    } catch {}
  };
  if (!observersRegistered) {
    observersRegistered = true;
    onCLS(send);
    onFCP(send);
    onINP(send);
    onLCP(send);
    onTTFB(send);
  }
  // Only detach if this instance is still the active one; a reinstall that
  // already replaced it owns the slot now and must keep receiving vitals.
  return () => {
    if (activeScout === scout) activeScout = null;
  };
}
