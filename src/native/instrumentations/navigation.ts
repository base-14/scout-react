import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { uuidv4 } from '../../core/uuid';
import { withSuppression } from '../soft-load';
let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}
let activeScreen: string | null = null;
export function getCurrentScreen(): string | null {
  return activeScreen;
}
interface NavigationRef {
  getCurrentRoute?: () =>
    | {
        name?: string;
      }
    | undefined;
  addListener?: (event: string, cb: () => void) => () => void;
}
export function installNativeNavigationTracker(
  scout: Scout,
  navigationRef: NavigationRef,
): () => void {
  const initialName = navigationRef.getCurrentRoute?.()?.name;
  let currentScreen = initialName ?? 'unknown';
  activeScreen = currentScreen;
  scout.setCurrentScreen(currentScreen);
  let previousScreen = '';
  const initialNavStartMs = Date.now();
  let enterAt = initialNavStartMs;
  let isFirstScreen = true;
  startScreen(currentScreen);
  scout.addBreadcrumb(BREADCRUMB_TYPE.NAVIGATION, `screen: ${currentScreen}`);
  if (initialName) emitScreenLoad(initialName, initialNavStartMs);
  if (!navigationRef.addListener) return () => {};
  const unsub = navigationRef.addListener('state', () => {
    const next = navigationRef.getCurrentRoute?.()?.name;
    if (!next || next === currentScreen) return;
    const elapsed = (Date.now() - enterAt) / 1000;
    scout.emitSpan(SPAN.VIEW_SESSION, {
      [ATTR.SCREEN_NAME]: currentScreen,
      [ATTR.VIEW_TIME_SPENT]: elapsed,
      ...scout.commonAttributes(),
    });
    scout.addBreadcrumb(
      BREADCRUMB_TYPE.VIEW_SESSION,
      `exited: ${currentScreen} (${Math.round(elapsed * 1000)}ms)`,
    );
    const interaction = scout.consumeInteractionForInv?.();
    if (interaction) {
      const invMs = Date.now() - interaction.at;
      scout.emitSpan(SPAN.APP_VITAL, {
        [ATTR.VITAL_NAME]: 'inv',
        [ATTR.VITAL_TYPE]: 'navigation',
        [ATTR.VITAL_DURATION]: invMs / 1000,
        [ATTR.VITAL_DURATION_MS]: invMs,
        [ATTR.VITAL_FROM_SCREEN]: interaction.fromScreen ?? currentScreen,
        [ATTR.VITAL_TO_SCREEN]: next,
        ...scout.commonAttributes(),
      });
    }
    const navStartMs = Date.now();
    previousScreen = currentScreen;
    currentScreen = next;
    activeScreen = next;
    scout.setCurrentScreen(next);
    enterAt = navStartMs;
    startScreen(next);
    scout.addBreadcrumb(BREADCRUMB_TYPE.NAVIGATION, `screen: ${next}`);
    emitScreenLoad(next, navStartMs);
  });
  let appStateSub:
    | {
        remove?: () => void;
      }
    | undefined;
  try {
    if (RN?.AppState) {
      appStateSub = RN.AppState.addEventListener('change', (state: string) => {
        if (state === 'active' && scout.rootSpan == null) {
          const name = navigationRef.getCurrentRoute?.()?.name;
          if (name) {
            currentScreen = name;
            activeScreen = name;
            scout.setCurrentScreen(name);
            enterAt = Date.now();
            startScreen(name);
          }
        }
      });
    }
  } catch {}
  return () => {
    unsub?.();
    try {
      appStateSub?.remove?.();
    } catch {}
  };
  function startScreen(name: string) {
    const loadingType = isFirstScreen ? 'initial_load' : 'route_change';
    isFirstScreen = false;
    scout.startRootSpan(SPAN.SCREEN_VIEW, {
      [ATTR.SCREEN_NAME]: name,
      [ATTR.VIEW_ID]: uuidv4(),
      [ATTR.VIEW_LOADING_TYPE]: loadingType,
      ...(previousScreen ? { [ATTR.VIEW_REFERRER]: previousScreen } : {}),
      [ATTR.VIEW_IS_ACTIVE]: true,
    });
  }
  function emitScreenLoad(name: string, startMs: number) {
    setTimeout(() => {
      const loadSec = (Date.now() - startMs) / 1000;
      scout.emitSpan(SPAN.SCREEN_LOAD, {
        [ATTR.SCREEN_NAME]: name,
        [ATTR.SCREEN_LOAD_TIME]: loadSec,
        [ATTR.VIEW_LOADING_TIME_MS]: Math.round(loadSec * 1000),
        ...scout.commonAttributes(),
      });
    }, 0);
  }
}
