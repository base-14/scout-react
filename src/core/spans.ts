export const SPAN = {
  USER_INTERACTION: 'user_interaction',
  /** A frustration signal (dead / rage / error click) about an interaction.
   *  A separate name because the original `user_interaction` span is already
   *  emitted and ended by the time detection completes, and re-emitting under
   *  that name double-counted every frustrated click in `view.action.count`. */
  USER_FRUSTRATION: 'user_frustration',
  SCREEN_VIEW: 'screen_view',
  SCREEN_LOAD: 'screen_load',
  VIEW_SESSION: 'view_session',
  APP_STARTUP: 'app_startup',
  APP_PAUSED: 'app_paused',
  APP_RESUMED: 'app_resumed',
  APP_CRASH: 'app_crash',
  /** A session that ended without a clean shutdown signal. Deliberately NOT
   *  `app_crash`: `pagehide` does not fire on force-quit, OS shutdown, tab
   *  discard or task-switcher eviction, so its absence is not evidence of a
   *  crash and must not depress crash-free rate. */
  APP_UNCLEAN_EXIT: 'app_unclean_exit',
  NATIVE_CRASH: 'native_crash',
  /** A process death that is NOT a crash but worth seeing: Android
   *  ApplicationExitInfo REASON_LOW_MEMORY (the OS reclaiming a cached
   *  background process). Play Console and Crashlytics don't count it, and
   *  neither does any crash-free rate; it only shows in session timelines. */
  APP_EXIT: 'app_exit',
  ERROR: 'error',
  LONG_TASK: 'long_task',
  FROZEN_FRAME: 'frozen_frame',
  ANR: 'anr',
  UI_HANG: 'ui_hang',
  APP_LIFECYCLE_CHANGED: 'app_lifecycle.changed',
  HTTP_REQUEST: 'http.request',
  WEB_VITAL: 'web_vital',
  CUSTOM_TIMING: 'custom_timing',
  APP_VITAL: 'app_vital',
  OPERATION_STEP: 'operation_step',
} as const;
export const ERROR_CLASS_SPANS: ReadonlySet<string> = new Set([
  SPAN.ERROR,
  SPAN.NATIVE_CRASH,
  SPAN.APP_CRASH,
  SPAN.ANR,
  SPAN.UI_HANG,
]);
export const BREADCRUMB_TYPE = {
  TAP: 'tap',
  NAVIGATION: 'navigation',
  VIEW_SESSION: 'view_session',
  LIFECYCLE: 'lifecycle',
  STARTUP: 'startup',
  ERROR: 'error',
  LONG_TASK: 'long_task',
  ANR: 'anr',
  FROZEN_FRAME: 'frozen_frame',
  HTTP: 'http',
} as const;
