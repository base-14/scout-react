import type { PlatformAdapter } from '../core/platform';
import { ATTR } from '../core/attributes';
import { withSuppression } from './soft-load';
let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}
let AsyncStorage: any = null;
try {
  AsyncStorage = withSuppression(() =>
    require('@react-native-async-storage/async-storage'),
  )?.default;
} catch {}
let NetInfo: any = null;
try {
  NetInfo = withSuppression(() => require('@react-native-community/netinfo'))?.default;
} catch {}
let DeviceInfo: any = null;
try {
  DeviceInfo = withSuppression(() => require('react-native-device-info'))?.default;
} catch {}
let ExpoBattery: any = null;
try {
  ExpoBattery = withSuppression(() => require('expo-battery'));
} catch {}
const memoryStore = new Map<string, string>();
export class NativePlatform implements PlatformAdapter {
  readonly name = 'react-native' as const;
  private connectionType = 'unknown';
  async getItem(key: string): Promise<string | null> {
    if (AsyncStorage) {
      try {
        return await AsyncStorage.getItem(key);
      } catch {
        return null;
      }
    }
    return memoryStore.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    if (AsyncStorage) {
      try {
        await AsyncStorage.setItem(key, value);
        return;
      } catch {}
    }
    memoryStore.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    if (AsyncStorage) {
      try {
        await AsyncStorage.removeItem(key);
        return;
      } catch {}
    }
    memoryStore.delete(key);
  }
  async collectResourceAttributes(): Promise<Record<string, string | number | boolean>> {
    const attrs: Record<string, string | number | boolean> = {};
    attrs[ATTR.NETWORK_CONNECTION_TYPE] = this.connectionType;
    if (RN?.Platform) {
      const osMap: Record<string, string> = {
        ios: 'iOS',
        android: 'Android',
        macos: 'macOS',
        windows: 'Windows',
        web: 'web',
      };
      const rawOs = String(RN.Platform.OS);
      attrs[ATTR.OS_NAME] = osMap[rawOs] ?? rawOs;
      if (RN.Platform.Version != null) {
        const v = String(RN.Platform.Version);
        attrs[ATTR.OS_VERSION] = v;
        const major = v.split('.')[0];
        if (major) attrs[ATTR.OS_VERSION_MAJOR] = major;
      }
    }
    if (DeviceInfo) {
      try {
        attrs[ATTR.DEVICE_MODEL_NAME] = await DeviceInfo.getModel();
        attrs[ATTR.DEVICE_MANUFACTURER] = await DeviceInfo.getManufacturer();
        attrs[ATTR.DEVICE_BRAND] = await DeviceInfo.getBrand();
        attrs[ATTR.DEVICE_IS_PHYSICAL] = String(!(await DeviceInfo.isEmulator()));
        try {
          const abis = await DeviceInfo.supportedAbis?.();
          if (Array.isArray(abis) && abis[0]) {
            attrs[ATTR.DEVICE_ARCHITECTURE] = normalizeArch(String(abis[0]));
          }
        } catch {}
        try {
          const buildNum = await DeviceInfo.getSystemBuildId?.();
          if (typeof buildNum === 'string' && buildNum) {
            attrs[ATTR.OS_BUILD] = buildNum;
          }
        } catch {}
        try {
          const machine = await DeviceInfo.getDeviceId?.();
          if (typeof machine === 'string' && machine) {
            attrs[ATTR.DEVICE_NAME] = machine;
          }
        } catch {}
        try {
          const ram = await DeviceInfo.getTotalMemory?.();
          if (typeof ram === 'number' && ram > 0) {
            attrs[ATTR.DEVICE_TOTAL_RAM] = Math.round(ram / (1024 * 1024));
          }
        } catch {}
        try {
          const isLowRam = await DeviceInfo.isLowRamDevice?.();
          if (typeof isLowRam === 'boolean') {
            attrs[ATTR.DEVICE_IS_LOW_RAM] = isLowRam;
          }
        } catch {}
        try {
          const isTablet = await DeviceInfo.isTablet?.();
          if (isTablet) attrs[ATTR.DEVICE_TYPE] = 'tablet';
          else attrs[ATTR.DEVICE_TYPE] = 'mobile';
        } catch {}
      } catch {}
    }
    try {
      const ExpoModules = withSuppression(() => require('expo-modules-core'));
      const ScoutCrash: any =
        ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
      if (ScoutCrash) {
        if (typeof ScoutCrash.isDeviceCompromised === 'function') {
          try {
            const compromised = await ScoutCrash.isDeviceCompromised();
            if (typeof compromised === 'boolean') {
              attrs['device.is_jail_broken'] = String(compromised);
            }
          } catch {}
        }
        if (typeof ScoutCrash.getNdkBuildId === 'function') {
          try {
            const buildId = await ScoutCrash.getNdkBuildId();
            if (typeof buildId === 'string' && buildId.length > 0) {
              attrs['ndk.build_id'] = buildId;
            }
          } catch {}
        }
      }
    } catch {}
    try {
      const intl = (globalThis as any).Intl?.DateTimeFormat?.();
      if (intl?.resolvedOptions) {
        const opts = intl.resolvedOptions();
        if (opts.locale) attrs[ATTR.DEVICE_LOCALE] = String(opts.locale);
        if (opts.timeZone) attrs[ATTR.DEVICE_TIMEZONE] = String(opts.timeZone);
      }
    } catch {}
    try {
      const cpus = (globalThis as any).navigator?.hardwareConcurrency;
      if (typeof cpus === 'number' && cpus > 0) {
        attrs[ATTR.DEVICE_LOGICAL_CPU_COUNT] = cpus;
      }
    } catch {}
    try {
      if (RN?.I18nManager?.isRTL != null) {
        attrs[ATTR.A11Y_RTL_ENABLED] = !!RN.I18nManager.isRTL;
      }
    } catch {}
    try {
      const psm = ExpoBattery?.isLowPowerModeEnabledAsync
        ? await ExpoBattery.isLowPowerModeEnabledAsync()
        : DeviceInfo?.isPowerSaveMode
          ? await DeviceInfo.isPowerSaveMode()
          : null;
      if (typeof psm === 'boolean') attrs[ATTR.DEVICE_POWER_SAVING_MODE] = psm;
    } catch {}
    if (RN?.Dimensions) {
      try {
        const win = RN.Dimensions.get('window');
        attrs['screen.width'] = win.width;
        attrs['screen.height'] = win.height;
        attrs['screen.pixel_ratio'] = win.scale;
        attrs[ATTR.VIEWPORT_WIDTH] = win.width;
        attrs[ATTR.VIEWPORT_HEIGHT] = win.height;
      } catch {}
    }
    try {
      const intl = (globalThis as any).Intl?.DateTimeFormat?.();
      if (intl?.resolvedOptions) {
        const opts = intl.resolvedOptions();
        if (opts.locale) attrs[ATTR.APPLICATION_LOCALE] = String(opts.locale);
      }
    } catch {}
    try {
      const battery = await readBattery();
      if (battery.level != null) attrs[ATTR.DEVICE_BATTERY_LEVEL] = battery.level;
      if (battery.state) attrs[ATTR.DEVICE_BATTERY_STATE] = battery.state;
    } catch {}
    return attrs;
  }
  getConnectionType(): string {
    return this.connectionType;
  }
  async readAppVersion(): Promise<string | null> {
    if (!DeviceInfo) return null;
    try {
      const v = String((await DeviceInfo.getVersion?.()) ?? '').trim();
      if (!v) return null;
      const b = String((await DeviceInfo.getBuildNumber?.()) ?? '').trim();
      return b ? `${v}+${b}` : v;
    } catch {
      return null;
    }
  }
  async readAppMetadata(): Promise<{
    version: string | null;
    build: string | null;
    bundleId: string | null;
  }> {
    if (!DeviceInfo) return { version: null, build: null, bundleId: null };
    try {
      const version = String((await DeviceInfo.getVersion?.()) ?? '').trim() || null;
      const build = String((await DeviceInfo.getBuildNumber?.()) ?? '').trim() || null;
      const bundleId = String((await DeviceInfo.getBundleId?.()) ?? '').trim() || null;
      return { version, build, bundleId };
    } catch {
      return { version: null, build: null, bundleId: null };
    }
  }
  onConnectivityChange(handler: (type: string) => void): () => void {
    return this._onConnectivityChange(handler);
  }
  private _onConnectivityChange(handler: (type: string) => void): () => void {
    if (!NetInfo) return () => {};
    try {
      const unsub = NetInfo.addEventListener((state: any) => {
        const t = state?.type ?? 'unknown';
        this.connectionType = t;
        handler(t);
      });
      return () => {
        try {
          unsub();
        } catch {}
      };
    } catch {
      return () => {};
    }
  }
}
async function readBattery(): Promise<{
  level: number | null;
  state: string | null;
}> {
  if (ExpoBattery) {
    try {
      const [rawLevel, rawState] = await Promise.all([
        ExpoBattery.getBatteryLevelAsync(),
        ExpoBattery.getBatteryStateAsync(),
      ]);
      const level =
        typeof rawLevel === 'number' && rawLevel >= 0 ? Math.round(rawLevel * 100) : null;
      const state = mapExpoBatteryState(rawState);
      return { level, state };
    } catch {}
  }
  if (DeviceInfo) {
    try {
      const [rawLevel, charging] = await Promise.all([
        DeviceInfo.getBatteryLevel(),
        DeviceInfo.isBatteryCharging(),
      ]);
      const level =
        typeof rawLevel === 'number' && rawLevel >= 0 ? Math.round(rawLevel * 100) : null;
      return { level, state: charging ? 'charging' : 'discharging' };
    } catch {}
  }
  return { level: null, state: null };
}
function normalizeArch(raw: string): string {
  const s = raw.toLowerCase();
  if (s.startsWith('arm64') || s === 'arm64-v8a' || s === 'arm64e') return 'arm64';
  if (s.startsWith('armeabi') || s === 'arm32' || s === 'armv7') return 'arm32';
  if (s === 'x86_64' || s === 'amd64') return 'amd64';
  if (s === 'x86' || s === 'i386' || s === 'ia32') return 'x86';
  return s;
}
function mapExpoBatteryState(raw: unknown): string | null {
  switch (raw) {
    case 1:
      return 'discharging';
    case 2:
      return 'charging';
    case 3:
      return 'full';
    case 0:
    default:
      return 'unknown';
  }
}
