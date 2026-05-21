import { ATTR } from '../../core/attributes';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
let RN: any = null;
let React: any = null;
try {
  RN = withSuppression(() => require('react-native'));
  React = withSuppression(() => require('react'));
} catch {}
let observeScroll: ((e: any) => void) | null = null;
function installScrollViewPatch(): void {
  if (!RN || !React) return;
  if (RN.__scoutScrollViewPatched) return;
  const desc = Object.getOwnPropertyDescriptor(RN, 'ScrollView');
  if (!desc) return;
  let cachedPatched: any = null;
  const buildPatched = (Original: any): any => {
    if (!Original) return Original;
    const Patched = React.forwardRef(function ScoutScrollView(props: any, ref: any) {
      const userOnScroll = props?.onScroll;
      const composed = (e: any) => {
        try {
          observeScroll?.(e);
        } catch {}
        return userOnScroll?.(e);
      };
      const nextProps: any = { ...props, onScroll: composed };
      if (nextProps.scrollEventThrottle == null) nextProps.scrollEventThrottle = 16;
      return React.createElement(Original, { ...nextProps, ref });
    });
    Patched.displayName = 'ScrollView';
    try {
      Patched.Context = Original.Context;
    } catch {}
    for (const key of Object.keys(Original)) {
      if (Patched[key] === undefined) {
        try {
          Patched[key] = Original[key];
        } catch {}
      }
    }
    return Patched;
  };
  try {
    Object.defineProperty(RN, 'ScrollView', {
      configurable: true,
      enumerable: true,
      get() {
        if (cachedPatched == null) {
          const Original = desc.get ? desc.get() : desc.value;
          cachedPatched = buildPatched(Original);
        }
        return cachedPatched;
      },
    });
    RN.__scoutScrollViewPatched = true;
  } catch {}
}
installScrollViewPatch();
export function installNativeScrollTracker(scout: Scout): () => void {
  let currentRoot: unknown = scout.rootSpan;
  let maxDepth = 0;
  let maxDepthScrollTop = 0;
  let maxScrollHeight = 0;
  let maxHeightReachedAt = 0;
  let viewStartedAt = Date.now();
  observeScroll = (e: any) => {
    const span = scout.rootSpan;
    if (!span) return;
    if (span !== currentRoot) {
      currentRoot = span;
      maxDepth = 0;
      maxDepthScrollTop = 0;
      maxScrollHeight = 0;
      maxHeightReachedAt = 0;
      viewStartedAt = Date.now();
    }
    const ne = e?.nativeEvent ?? {};
    const scrollTop = Number(ne.contentOffset?.y ?? 0);
    const layoutH = Number(ne.layoutMeasurement?.height ?? 0);
    const contentH = Number(ne.contentSize?.height ?? 0);
    const depth = scrollTop + layoutH;
    const now = Date.now() - viewStartedAt;
    if (depth > maxDepth) {
      maxDepth = depth;
      maxDepthScrollTop = scrollTop;
    }
    if (contentH > maxScrollHeight) {
      maxScrollHeight = contentH;
      maxHeightReachedAt = now;
    }
    (span as any).setAttributes?.({
      [ATTR.DISPLAY_SCROLL_MAX_DEPTH]: Math.round(maxDepth),
      [ATTR.DISPLAY_SCROLL_MAX_DEPTH_SCROLL_TOP]: Math.round(maxDepthScrollTop),
      [ATTR.DISPLAY_SCROLL_MAX_SCROLL_HEIGHT]: Math.round(maxScrollHeight),
      [ATTR.DISPLAY_SCROLL_MAX_SCROLL_HEIGHT_TIME_MS]: Math.round(maxHeightReachedAt),
    });
  };
  return () => {
    observeScroll = null;
  };
}
