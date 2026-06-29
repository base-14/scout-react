import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
import { getCurrentScreen } from './navigation';
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
  mainThreadStack?: string;
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
      const screen = getCurrentScreen();
      const stack =
        typeof payload?.mainThreadStack === 'string' && payload.mainThreadStack.length > 0
          ? payload.mainThreadStack
          : null;
      scout.emitSpan(SPAN.UI_HANG, {
        [ATTR.UI_HANG_DURATION]: durationSec,
        [ATTR.UI_HANG_THRESHOLD]: thresholdSec,
        ...(screen ? { [ATTR.SCREEN_NAME]: screen } : {}),
        ...(stack ? { [ATTR.UI_HANG_MAIN_THREAD_STACK]: stack } : {}),
        [ATTR.BREADCRUMBS]: scout.breadcrumbsManager.serialize(),
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
