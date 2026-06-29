import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';

interface ScoutCrashBatteryApi {
  getBatteryDischargeRate?(): Promise<number | null>;
}

const SAMPLE_INTERVAL_MS = 60000;

export function installBatteryDischargeTracker(scout: Scout): () => void {
  let ScoutCrash: ScoutCrashBatteryApi | null = null;
  try {
    const ExpoModules = withSuppression(() => require('expo-modules-core'));
    ScoutCrash = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
  } catch {}
  if (!ScoutCrash || typeof ScoutCrash.getBatteryDischargeRate !== 'function') {
    return () => {};
  }
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const rate = await ScoutCrash!.getBatteryDischargeRate!();
      if (typeof rate === 'number' && isFinite(rate)) {
        scout.setRuntimeAttribute('device.battery.discharge_rate', rate);
      }
    } catch {}
  };
  void tick();
  const id = setInterval(tick, SAMPLE_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}
