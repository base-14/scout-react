import { useCallback, useRef } from 'react';
import { ATTR } from '../core/attributes';

interface ScrollEventPayload {
  nativeEvent?: {
    contentOffset?: { x?: number; y?: number };
    contentSize?: { width?: number; height?: number };
    layoutMeasurement?: { width?: number; height?: number };
  };
}

interface ScoutScrollTracking {
  onScroll: (event: ScrollEventPayload) => void;
  scrollEventThrottle: number;
  reset: () => void;
}

export function useScoutScrollTracking(options?: {
  throttleMs?: number;
}): ScoutScrollTracking {
  const throttle = Math.max(16, options?.throttleMs ?? 100);
  const stateRef = useRef({
    maxDepth: 0,
    maxDepthScrollTop: 0,
    maxScrollHeight: 0,
    maxScrollHeightAt: 0,
    screenStartedAt: Date.now(),
    lastWriteAt: 0,
  });

  const reset = useCallback(() => {
    stateRef.current = {
      maxDepth: 0,
      maxDepthScrollTop: 0,
      maxScrollHeight: 0,
      maxScrollHeightAt: 0,
      screenStartedAt: Date.now(),
      lastWriteAt: 0,
    };
  }, []);

  const onScroll = useCallback(
    (event: ScrollEventPayload) => {
      const ne = event?.nativeEvent;
      if (!ne) return;
      const offsetY = Math.max(0, Number(ne.contentOffset?.y ?? 0));
      const viewport = Number(ne.layoutMeasurement?.height ?? 0);
      const content = Number(ne.contentSize?.height ?? 0);
      if (viewport <= 0 || content <= 0) return;
      const depth = offsetY + viewport;
      const s = stateRef.current;
      let changed = false;
      if (depth > s.maxDepth) {
        s.maxDepth = depth;
        s.maxDepthScrollTop = offsetY;
        changed = true;
      }
      if (content > s.maxScrollHeight) {
        s.maxScrollHeight = content;
        s.maxScrollHeightAt = Date.now() - s.screenStartedAt;
        changed = true;
      }
      if (!changed) return;
      const now = Date.now();
      if (now - s.lastWriteAt < throttle) return;
      s.lastWriteAt = now;
      try {
        const Scout = require('./index').Scout;
        const inst = Scout.instance;
        if (!inst) return;
        inst.setRuntimeAttribute(ATTR.DISPLAY_SCROLL_MAX_DEPTH, Math.round(s.maxDepth));
        inst.setRuntimeAttribute(
          ATTR.DISPLAY_SCROLL_MAX_DEPTH_SCROLL_TOP,
          Math.round(s.maxDepthScrollTop),
        );
        inst.setRuntimeAttribute(
          ATTR.DISPLAY_SCROLL_MAX_SCROLL_HEIGHT,
          Math.round(s.maxScrollHeight),
        );
        inst.setRuntimeAttribute(
          ATTR.DISPLAY_SCROLL_MAX_SCROLL_HEIGHT_TIME_MS,
          s.maxScrollHeightAt,
        );
      } catch {}
    },
    [throttle],
  );

  return { onScroll, scrollEventThrottle: throttle, reset };
}
