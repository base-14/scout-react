import type { Scout } from '../../core/scout';
export function installErrorTracker(scout: Scout): () => void {
  if (typeof window === 'undefined') return () => {};
  const onError = (event: ErrorEvent) => {
    try {
      scout.reportUncaught(event.error ?? new Error(event.message));
    } catch {}
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason;
      scout.reportUncaught(reason instanceof Error ? reason : new Error(String(reason)));
    } catch {}
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
