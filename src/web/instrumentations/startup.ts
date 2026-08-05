import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
// Navigation timing describes the document, not this installation. A host that
// mounts and unmounts the SDK (a Grafana app plugin, a micro-frontend) would
// otherwise re-report the very same page load on every entry, with identical
// timings, quietly skewing every startup percentile downstream.
let coldStartEmitted = false;

/** Test-only: clears the per-document cold-start latch. */
export function __resetStartupStateForTests(): void {
  coldStartEmitted = false;
}

export function installStartupTracker(scout: Scout): () => void {
  if (typeof performance === 'undefined') return () => {};
  const emitCold = () => {
    if (coldStartEmitted) return;
    try {
      const entries = performance.getEntriesByType(
        'navigation',
      ) as PerformanceNavigationTiming[];
      const nav = entries[0];
      // Latch only on a real emission: a document with no navigation entry
      // yet must stay eligible rather than burn its one cold start on a no-op.
      if (!nav) return;
      coldStartEmitted = true;
      const duration = (nav.loadEventEnd || nav.domContentLoadedEventEnd) / 1000;
      scout.emitSpan(SPAN.APP_STARTUP, {
        [ATTR.APP_STARTUP_TYPE]: 'cold',
        [ATTR.APP_STARTUP_DURATION]: duration,
        [ATTR.BROWSER_NAV_DOM_COMPLETE_MS]: nav.domComplete,
        [ATTR.BROWSER_NAV_DOM_CONTENT_LOADED_MS]: nav.domContentLoadedEventEnd,
        [ATTR.BROWSER_NAV_DOM_INTERACTIVE_MS]: nav.domInteractive,
        [ATTR.BROWSER_NAV_LOAD_EVENT_MS]: nav.loadEventEnd,
        [ATTR.BROWSER_NAV_FIRST_BYTE_MS]: nav.responseStart,
        ...scout.commonAttributes(),
      });
      scout.addBreadcrumb(
        BREADCRUMB_TYPE.STARTUP,
        `cold start: ${Math.round(duration * 1000)}ms`,
      );
    } catch {}
  };
  if (typeof document !== 'undefined' && document.readyState === 'complete') {
    queueMicrotask(emitCold);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', emitCold, { once: true });
  }
  const onPageShow = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    scout.emitSpan(SPAN.APP_STARTUP, {
      [ATTR.APP_STARTUP_TYPE]: 'warm',
      [ATTR.APP_STARTUP_DURATION]: 0,
      ...scout.commonAttributes(),
    });
    scout.addBreadcrumb(BREADCRUMB_TYPE.STARTUP, 'warm start (bfcache)');
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', onPageShow);
  }
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pageshow', onPageShow);
    }
  };
}
