import { ATTR } from '../../core/attributes';
import type { Scout } from '../../core/scout';
interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}
export function installBatteryTracker(scout: Scout): () => void {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav?.getBattery) return () => {};
  let battery: BatteryManagerLike | null = null;
  const update = () => {
    if (!battery) return;
    scout.setRuntimeAttribute(ATTR.DEVICE_BATTERY_LEVEL, Math.round(battery.level * 100));
    scout.setRuntimeAttribute(
      ATTR.DEVICE_BATTERY_STATE,
      battery.charging ? 'charging' : 'discharging',
    );
  };
  let disposed = false;
  const onChange = () => update();
  nav
    .getBattery()
    .then((b: BatteryManagerLike) => {
      if (disposed) return;
      battery = b;
      update();
      b.addEventListener('levelchange', onChange);
      b.addEventListener('chargingchange', onChange);
    })
    .catch(() => {});
  return () => {
    disposed = true;
    if (battery) {
      try {
        battery.removeEventListener('levelchange', onChange);
        battery.removeEventListener('chargingchange', onChange);
      } catch {}
    }
  };
}
