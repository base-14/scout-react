import { ATTR } from '../../core/attributes';
import type { Scout } from '../../core/scout';
export function installScrollDepthTracker(scout: Scout): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let rafScheduled = false;
  let maxDepth = 0;
  let maxDepthScrollTop = 0;
  let maxScrollHeight = 0;
  let maxHeightReachedAt = 0;
  const viewStartedAt = performance.now();
  let currentRoot: unknown = scout.rootSpan;
  const flushToSpan = () => {
    rafScheduled = false;
    const span = scout.rootSpan;
    if (!span) return;
    if (span !== currentRoot) {
      currentRoot = span;
      maxDepth = 0;
      maxDepthScrollTop = 0;
      maxScrollHeight = 0;
      maxHeightReachedAt = 0;
    }
    try {
      const scrollTop = window.scrollY;
      const viewportH = window.innerHeight;
      const docH = document.documentElement.scrollHeight;
      const depth = scrollTop + viewportH;
      const now = performance.now() - viewStartedAt;
      if (depth > maxDepth) {
        maxDepth = depth;
        maxDepthScrollTop = scrollTop;
      }
      if (docH > maxScrollHeight) {
        maxScrollHeight = docH;
        maxHeightReachedAt = now;
      }
      span.setAttributes({
        [ATTR.DISPLAY_SCROLL_MAX_DEPTH]: Math.round(maxDepth),
        [ATTR.DISPLAY_SCROLL_MAX_DEPTH_SCROLL_TOP]: Math.round(maxDepthScrollTop),
        [ATTR.DISPLAY_SCROLL_MAX_SCROLL_HEIGHT]: Math.round(maxScrollHeight),
        [ATTR.DISPLAY_SCROLL_MAX_SCROLL_HEIGHT_TIME_MS]: Math.round(maxHeightReachedAt),
      });
    } catch {}
  };
  const onScroll = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(flushToSpan);
  };
  requestAnimationFrame(flushToSpan);
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onScroll, { passive: true });
  return () => {
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('resize', onScroll);
  };
}
