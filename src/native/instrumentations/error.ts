import type { Scout } from '../../core/scout';
export function installNativeRejectionTracker(scout: Scout): () => void {
  const g: any = globalThis as any;
  const tracker = g.HermesInternal?.enablePromiseRejectionTracker;
  if (typeof tracker !== 'function') return () => {};
  try {
    tracker({
      allRejections: true,
      onUnhandled: (_id: number, err: unknown) => {
        scout.reportUncaught(err);
      },
      onHandled: () => {},
    });
  } catch {
    return () => {};
  }
  return () => {
    try {
      tracker({
        allRejections: false,
        onUnhandled: () => {},
        onHandled: () => {},
      });
    } catch {}
  };
}
