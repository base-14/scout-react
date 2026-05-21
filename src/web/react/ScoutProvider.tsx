import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { Scout } from '../index';
import type { ScoutConfig } from '../../core/config';
interface ScoutContextValue {
  ready: boolean;
}
const ScoutContext = createContext<ScoutContextValue>({ ready: false });
export interface ScoutProviderProps {
  config: ScoutConfig;
  children: ReactNode;
  fallback?: ReactNode;
}
export function ScoutProvider({ config, children, fallback }: ScoutProviderProps) {
  const initRef = useRef(false);
  const stable = useMemo(
    () => config,
    [config.serviceName, config.endpoint, config.serviceVersion, config.environment],
  );
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void Scout.initialize(stable);
    return () => {};
  }, [stable]);
  return (
    <ScoutContext.Provider value={{ ready: Scout.isInitialized }}>
      {Scout.isInitialized || !fallback ? children : fallback}
    </ScoutContext.Provider>
  );
}
export function useScoutReady(): boolean {
  return useContext(ScoutContext).ready;
}
