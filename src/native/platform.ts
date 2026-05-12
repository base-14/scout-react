import type { PlatformAdapter } from '../core/platform';
import { ATTR } from '../core/attributes';
import { withSuppression } from './soft-load';
let RN: any = null;
try {
    RN = withSuppression(() => require('react-native'));
}
catch {
}
let AsyncStorage: any = null;
try {
    AsyncStorage = withSuppression(() => require('@react-native-async-storage/async-storage'))?.default;
}
catch {
}
let NetInfo: any = null;
try {
    NetInfo = withSuppression(() => require('@react-native-community/netinfo'))?.default;
}
catch {
}
let DeviceInfo: any = null;
try {
    DeviceInfo = withSuppression(() => require('react-native-device-info'))?.default;
}
catch {
}
const memoryStore = new Map<string, string>();
export class NativePlatform implements PlatformAdapter {
    readonly name = 'react-native' as const;
    private connectionType = 'unknown';
    async getItem(key: string): Promise<string | null> {
        if (AsyncStorage) {
            try {
                return await AsyncStorage.getItem(key);
            }
            catch {
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
            }
            catch {
            }
        }
        memoryStore.set(key, value);
    }
    async removeItem(key: string): Promise<void> {
        if (AsyncStorage) {
            try {
                await AsyncStorage.removeItem(key);
                return;
            }
            catch {
            }
        }
        memoryStore.delete(key);
    }
    async collectResourceAttributes(): Promise<Record<string, string | number | boolean>> {
        const attrs: Record<string, string | number | boolean> = {};
        if (RN?.Platform) {
            attrs[ATTR.OS_NAME] = String(RN.Platform.OS);
            if (RN.Platform.Version != null) {
                attrs[ATTR.OS_VERSION] = String(RN.Platform.Version);
            }
        }
        if (DeviceInfo) {
            try {
                attrs[ATTR.DEVICE_MODEL_NAME] = await DeviceInfo.getModel();
                attrs[ATTR.DEVICE_MANUFACTURER] = await DeviceInfo.getManufacturer();
                attrs[ATTR.DEVICE_BRAND] = await DeviceInfo.getBrand();
                attrs[ATTR.DEVICE_IS_PHYSICAL] = String(!(await DeviceInfo.isEmulator()));
            }
            catch {
            }
        }
        if (RN?.Dimensions) {
            try {
                const win = RN.Dimensions.get('window');
                attrs['screen.width'] = win.width;
                attrs['screen.height'] = win.height;
                attrs['screen.pixel_ratio'] = win.scale;
            }
            catch {
            }
        }
        return attrs;
    }
    getConnectionType(): string {
        return this.connectionType;
    }
    onConnectivityChange(handler: (type: string) => void): () => void {
        if (!NetInfo)
            return () => { };
        try {
            const unsub = NetInfo.addEventListener((state: any) => {
                const t = state?.type ?? 'unknown';
                this.connectionType = t;
                handler(t);
            });
            return () => {
                try {
                    unsub();
                }
                catch {
                }
            };
        }
        catch {
            return () => { };
        }
    }
}
