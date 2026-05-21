import { ATTR } from '../../core/attributes';
import type { Scout } from '../../core/scout';
export function installPageStateTracker(scout: Scout): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  type Entry = {
    state: string;
    start: number;
  };
  let entries: Entry[] = [];
  let currentRoot: unknown = scout.rootSpan;
  let viewStart = performance.now();
  const mapState = (): string => {
    const vs = document.visibilityState;
    if (vs === 'visible') return 'active';
    if (vs === 'hidden') return 'hidden';
    return 'passive';
  };
  const flush = () => {
    const span = scout.rootSpan;
    if (!span) return;
    if (span !== currentRoot) {
      currentRoot = span;
      entries = [];
      viewStart = performance.now();
    }
    try {
      span.setAttribute(ATTR.VIEW_PAGE_STATES_JSON, JSON.stringify(entries));
    } catch {}
  };
  const record = (state: string) => {
    entries.push({ state, start: Math.round(performance.now() - viewStart) });
    flush();
  };
  record(mapState());
  const onVisibility = () => record(mapState());
  const onFreeze = () => record('frozen');
  const onResume = () => record(mapState());
  const onPageHide = (e: PageTransitionEvent) =>
    record(e.persisted ? 'frozen' : 'terminated');
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('freeze', onFreeze as EventListener);
  document.addEventListener('resume', onResume as EventListener);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('freeze', onFreeze as EventListener);
    document.removeEventListener('resume', onResume as EventListener);
    window.removeEventListener('pagehide', onPageHide);
  };
}
