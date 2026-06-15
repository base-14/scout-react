import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}

interface ScoutCrashHangApi {
  startHangDetection(thresholdMs: number): Promise<void>;
  stopHangDetection(): Promise<void>;
  addListener?(event: string, cb: (payload: HangPayload) => void): { remove: () => void };
}

interface HangPayload {
  durationMs?: number;
  thresholdMs?: number;
}

export async function installUiHangDetector(
  scout: Scout,
  thresholdMs: number,
): Promise<() => void> {
  if (RN?.Platform?.OS !== 'ios' || thresholdMs <= 0) return () => {};
  let ScoutCrash: ScoutCrashHangApi | null = null;
  try {
    const ExpoModules = withSuppression(() => require('expo-modules-core'));
    ScoutCrash = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
  } catch {}
  if (!ScoutCrash || typeof ScoutCrash.startHangDetection !== 'function') {
    return () => {};
  }
  const sub = ScoutCrash.addListener?.('ScoutUIHang', (payload: HangPayload) => {
    const durationMs = Number(payload?.durationMs ?? 0);
    if (durationMs <= 0) return;
    const durationSec = durationMs / 1000;
    const thresholdSec = Number(payload?.thresholdMs ?? thresholdMs) / 1000;
    try {
      scout.emitSpan(SPAN.UI_HANG, {
        [ATTR.UI_HANG_DURATION]: durationSec,
        [ATTR.UI_HANG_THRESHOLD]: thresholdSec,
        ...scout.commonAttributes(),
      });
      scout.breadcrumbsManager.add(BREADCRUMB_TYPE.ANR, `UI hang: ${durationMs}ms`);
    } catch {}
  });
  try {
    await ScoutCrash.startHangDetection(thresholdMs);
  } catch {}
  return () => {
    try {
      sub?.remove();
    } catch {}
    try {
      void ScoutCrash?.stopHangDetection();
    } catch {}
  };
}
