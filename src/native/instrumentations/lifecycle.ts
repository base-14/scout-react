import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
import { uuidv4 } from '../../core/uuid';
let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}
function lifecycleStateBytes(state: string): Uint8Array {
  const buf = new Uint8Array(state.length);
  for (let i = 0; i < state.length; i++) buf[i] = state.charCodeAt(i) & 0xff;
  return buf;
}
export function installNativeLifecycleTracker(
  scout: Scout,
  onBackgroundFlush?: () => void | Promise<void>,
): () => void {
  const AppState = RN?.AppState;
  if (!AppState) return () => {};
  let last: string = AppState.currentState;
  let lastTransitionAt = Date.now();
  const onChange = (state: string) => {
    try {
      const now = Date.now();
      const previousDurationSec = (now - lastTransitionAt) / 1000;
      scout.emitSpan(SPAN.APP_LIFECYCLE_CHANGED, {
        [ATTR.APP_LIFECYCLE_ID]: uuidv4(),
        [ATTR.APP_LIFECYCLE_STATE]: state,
        [ATTR.APP_LIFECYCLE_STATE_ID]: lifecycleStateBytes(state),
        [ATTR.APP_LIFECYCLE_PREVIOUS_STATE]: last,
        [ATTR.APP_LIFECYCLE_PREVIOUS_STATE_ID]: lifecycleStateBytes(last),
        [ATTR.APP_LIFECYCLE_TIMESTAMP]: new Date(now).toISOString(),
        [ATTR.APP_LIFECYCLE_DURATION]: previousDurationSec,
        ...scout.commonAttributes(),
      });
      lastTransitionAt = now;
      if (last === 'active' && (state === 'background' || state === 'inactive')) {
        try {
          scout.setRootSpan(null);
        } catch {}
        scout.emitSpan(SPAN.APP_PAUSED, scout.commonAttributes());
        scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'app_paused');
        try {
          void onBackgroundFlush?.();
        } catch {}
      } else if (last !== 'active' && state === 'active') {
        const resumeStart = Date.now();
        void scout.sessionManager.maybeRotateOnResume().then(() => {
          scout.emitSpan(SPAN.APP_RESUMED, scout.commonAttributes());
          scout.addBreadcrumb(BREADCRUMB_TYPE.LIFECYCLE, 'app_resumed');
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
