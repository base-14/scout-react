import { useCallback, useMemo } from 'react';
import { Scout } from '../index';
import type { Attributes } from '../../core/types';
export function useScout() {
  return useMemo(
    () => ({
      logEvent: (name: string, attrs?: Attributes) => Scout.logEvent(name, attrs),
      addBreadcrumb: (type: string, message: string) =>
        Scout.addBreadcrumb(type, message),
      reportError: (
        error: unknown,
        opts?: {
          handled?: boolean;
          library?: string;
        },
      ) => Scout.reportError(error, opts),
      setUser: (id: string, attrs?: Attributes) => Scout.setUser(id, attrs),
      clearUser: () => Scout.clearUser(),
      logDebug: (m: string, attrs?: Attributes) => Scout.logDebug(m, attrs),
      logInfo: (m: string, attrs?: Attributes) => Scout.logInfo(m, attrs),
      logWarning: (m: string, attrs?: Attributes) => Scout.logWarning(m, attrs),
      logError: (m: string, attrs?: Attributes) => Scout.logError(m, attrs),
      get sessionId() {
        return Scout.sessionId;
      },
      get userId() {
        return Scout.userId;
      },
    }),
    [],
  );
}
export function useScoutScreen(name: string): void {
  const stable = useCallback(() => name, [name]);
  if (typeof window === 'undefined') return;
  if (Scout.isInitialized) {
    Scout.logEvent('screen_view', { 'screen.name': stable() });
  }
}
