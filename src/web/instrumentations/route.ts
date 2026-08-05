import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { uuidv4 } from '../../core/uuid';
let activeScreen: string | null = null;
export function getCurrentScreen(): string | null {
  return activeScreen;
}
export function installRouteTracker(scout: Scout): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') {
    return () => {};
  }
  let currentScreen = locationToScreen();
  activeScreen = currentScreen;
  scout.setCurrentScreen(currentScreen);
  let previousScreen = '';
  let enterTimeMs = performance.now();
  let isFirstScreen = true;
  startScreenSpan(currentScreen);
  const handleChange = () => {
    const next = locationToScreen();
    if (next === currentScreen) return;
    const elapsed = (performance.now() - enterTimeMs) / 1000;
    scout.emitSpan(SPAN.VIEW_SESSION, {
      [ATTR.SCREEN_NAME]: currentScreen,
      [ATTR.VIEW_TIME_SPENT]: elapsed,
      ...scout.commonAttributes(),
    });
    scout.addBreadcrumb(
      BREADCRUMB_TYPE.VIEW_SESSION,
      `exited: ${currentScreen} (${Math.round(elapsed * 1000)}ms)`,
    );
    previousScreen = currentScreen;
    currentScreen = next;
    activeScreen = next;
    scout.setCurrentScreen(next);
    enterTimeMs = performance.now();
    startScreenSpan(currentScreen);
  };
  function startScreenSpan(name: string) {
    const startedAt = performance.now();
    const loadingType = isFirstScreen ? 'initial_load' : 'route_change';
    isFirstScreen = false;
    const viewId = uuidv4();
    const url = typeof window !== 'undefined' ? window.location.href : '';
    scout.startRootSpan(SPAN.SCREEN_VIEW, {
      [ATTR.SCREEN_NAME]: name,
      [ATTR.VIEW_ID]: viewId,
      [ATTR.VIEW_URL]: url,
      [ATTR.VIEW_LOADING_TYPE]: loadingType,
      ...(previousScreen ? { [ATTR.VIEW_REFERRER]: previousScreen } : {}),
      [ATTR.VIEW_IS_ACTIVE]: true,
    });
    scout.addBreadcrumb(BREADCRUMB_TYPE.NAVIGATION, `screen: ${name}`);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const loadTime = (performance.now() - startedAt) / 1000;
        scout.emitSpan(SPAN.SCREEN_LOAD, {
          [ATTR.SCREEN_NAME]: name,
          [ATTR.SCREEN_LOAD_TIME]: loadTime,
          [ATTR.VIEW_LOADING_TIME_MS]: loadTime * 1000,
          ...scout.commonAttributes(),
        });
      });
    });
  }
  // Captured unbound, and called with `apply`, so the disposer can put the
  // original function back. Restoring a `.bind()` wrapper instead would leave
  // the page subtly altered and stack another layer on every reinstall — which
  // hosts that mount and unmount the SDK do on every visit.
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    const r = origPush.apply(history, args);
    queueMicrotask(handleChange);
    return r;
  };
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    const r = origReplace.apply(history, args);
    queueMicrotask(handleChange);
    return r;
  };
  window.addEventListener('popstate', handleChange);
  return () => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener('popstate', handleChange);
    scout.setRootSpan(null);
  };
}
function locationToScreen(): string {
  if (typeof window === 'undefined') return '/';
  const { pathname, hash } = window.location;
  return hash && hash.startsWith('#/') ? hash.slice(1) : pathname || '/';
}
