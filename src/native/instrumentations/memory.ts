import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
let DeviceInfo: any = null;
try {
    DeviceInfo = withSuppression(() => require('react-native-device-info'))?.default;
}
catch {
}
export function installNativeMemoryTracker(scout: Scout): () => void {
    if (!DeviceInfo?.getUsedMemory)
        return () => { };
    const tick = () => {
        DeviceInfo.getUsedMemory()
            .then((bytes: number) => {
            if (typeof bytes === 'number' && bytes >= 0) {
                scout.emitGauge(METRIC.RN_MEMORY_USAGE, bytes);
            }
        })
            .catch(() => {
        });
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
}
