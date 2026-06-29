import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
import { getCurrentScreen } from './navigation';

let RN: any = null;
try {
  RN = withSuppression(() => require('react-native'));
} catch {}

interface ScoutCrashAnrApi {
  startAnrDetection(thresholdMs: number): Promise<void>;
  stopAnrDetection(): Promise<void>;
  notifyJsAlive?(): Promise<void>;
  addListener?(event: string, cb: (payload: AnrPayload) => void): { remove: () => void };
}

interface AnrPayload {
  durationMs?: number;
  thresholdMs?: number;
  source?: string;
  mainThreadStack?: string;
  threadsJson?: string;
  threadCount?: number;
}

export async function installNativeAnrDetector(
  scout: Scout,
  thresholdMs: number,
): Promise<() => void> {
  if (RN?.Platform?.OS !== 'android' || thresholdMs <= 0) return () => {};
  let ScoutCrash: ScoutCrashAnrApi | null = null;
  try {
    const ExpoModules = withSuppression(() => require('expo-modules-core'));
    ScoutCrash = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
  } catch {}
  if (!ScoutCrash || typeof ScoutCrash.startAnrDetection !== 'function') {
    return () => {};
  }
  const sub = ScoutCrash.addListener?.('ScoutAnr', (payload: AnrPayload) => {
    const durationMs = Number(payload?.durationMs ?? 0);
    if (durationMs <= 0) return;
    const screen = getCurrentScreen();
    const source = typeof payload?.source === 'string' ? payload.source : 'main';
    const attrs: Record<string, unknown> = {
      [ATTR.ANR_DURATION]: durationMs / 1000,
      [ATTR.ANR_THRESHOLD]: Number(payload?.thresholdMs ?? thresholdMs) / 1000,
      'anr.source_thread': source,
      ...(screen ? { [ATTR.SCREEN_NAME]: screen } : {}),
      [ATTR.BREADCRUMBS]: scout.breadcrumbsManager.serialize(),
      ...scout.commonAttributes(),
    };
    if (
      typeof payload?.mainThreadStack === 'string' &&
      payload.mainThreadStack.length > 0
    ) {
      attrs[ATTR.ANR_MAIN_THREAD_STACK] = payload.mainThreadStack;
    }
    if (typeof payload?.threadsJson === 'string' && payload.threadsJson.length > 0) {
      attrs[ATTR.ANR_THREADS_JSON] = payload.threadsJson;
    }
    if (typeof payload?.threadCount === 'number' && payload.threadCount > 0) {
      attrs[ATTR.ANR_THREAD_COUNT] = payload.threadCount;
    }
    try {
      scout.emitSpan(SPAN.ANR, attrs as Record<string, never>);
      scout.breadcrumbsManager.add(
        BREADCRUMB_TYPE.ANR,
        `App not responding (${source}): ${Math.round(durationMs)}ms`,
      );
    } catch {}
  });
  try {
    await ScoutCrash.startAnrDetection(thresholdMs);
  } catch {}
  const heartbeatInterval = Math.max(500, Math.floor(thresholdMs / 5));
  const heartbeatId =
    typeof ScoutCrash?.notifyJsAlive === 'function'
      ? setInterval(() => {
          try {
            void ScoutCrash!.notifyJsAlive!();
          } catch {}
        }, heartbeatInterval)
      : null;
  return () => {
    if (heartbeatId !== null) {
      try {
        clearInterval(heartbeatId);
      } catch {}
    }
    try {
      sub?.remove();
    } catch {}
    try {
      void ScoutCrash?.stopAnrDetection();
    } catch {}
  };
}
