import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}
export function installNativeLifecycleTracker(
  scout: Scout,
  onBackgroundFlush?: () => void | Promise<void>,
): () => void {
  const AppState = RN?.AppState;
  if (!AppState) return () => {};
  let last: string = AppState.currentState;
  const onChange = (state: string) => {
    try {
      if (last === 'active' && (state === 'background' || state === 'inactive')) {
        try {
          scout.setRootSpan(null);
        } catch {}
        scout.emitSpan(SPAN.APP_PAUSED, scout.commonAttributes());
        scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'paused');
        try {
          void onBackgroundFlush?.();
        } catch {}
      } else if (last !== 'active' && state === 'active') {
        const resumeStart = Date.now();
        void scout.sessionManager.maybeRotateOnResume().then(() => {
          scout.emitSpan(SPAN.APP_RESUMED, scout.commonAttributes());
          scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'resumed');
        });
        const emitWarm = (durationMs: number) => {
          try {
            scout.emitSpan(SPAN.APP_STARTUP, {
              [ATTR.APP_STARTUP_TYPE]: 'warm',
              [ATTR.APP_STARTUP_DURATION]: durationMs / 1000,
              ...scout.commonAttributes(),
            });
          } catch {}
        };
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => emitWarm(Date.now() - resumeStart));
        } else {
          emitWarm(0);
        }
      }
      last = state;
    } catch {}
  };
  const sub = AppState.addEventListener('change', onChange);
  return () => {
    try {
      if (typeof sub?.remove === 'function') sub.remove();
      else AppState.removeEventListener?.('change', onChange);
    } catch {}
  };
}
