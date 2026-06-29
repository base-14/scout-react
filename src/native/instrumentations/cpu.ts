import { METRIC } from '../../core/metrics';
import type { Scout } from '../../core/scout';
import type { Attributes } from '../../core/types';
import { withSuppression } from '../soft-load';
import { getCurrentScreen } from './navigation';

interface ScoutCrashCpuApi {
  getCpuTicks?(): Promise<number>;
  getCpuPercent?(): Promise<number>;
}

const SAMPLE_INTERVAL_MS = 10000;

export function installNativeCpuTracker(scout: Scout): () => void {
  let ScoutCrash: ScoutCrashCpuApi | null = null;
  try {
    const ExpoModules = withSuppression(() => require('expo-modules-core'));
    ScoutCrash = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
  } catch {}
  const hasTicks = typeof ScoutCrash?.getCpuTicks === 'function';
  const hasPercent = typeof ScoutCrash?.getCpuPercent === 'function';
  if (!hasTicks && !hasPercent) return () => {};

  let lastTicks: number | null = null;
  let lastTimeMs: number | null = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const screen = getCurrentScreen();
      const attrs: Attributes = screen ? { 'screen.name': screen } : {};
      if (hasPercent) {
        const pct = await ScoutCrash!.getCpuPercent!();
        if (typeof pct === 'number' && isFinite(pct) && pct >= 0) {
          scout.emitGauge(METRIC.RN_CPU_USAGE, clamp(pct), attrs);
        }
      } else if (hasTicks) {
        const ticks = await ScoutCrash!.getCpuTicks!();
        const now = Date.now();
        if (typeof ticks === 'number' && ticks >= 0) {
          if (lastTicks !== null && lastTimeMs !== null) {
            const elapsed = now - lastTimeMs;
            if (elapsed > 0) {
              const tickDelta = ticks - lastTicks;
              const cpuMs = tickDelta * 10;
              const pct = (cpuMs / elapsed) * 100;
              scout.emitGauge(METRIC.RN_CPU_USAGE, clamp(pct), attrs);
            }
          }
          lastTicks = ticks;
          lastTimeMs = now;
        }
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

function clamp(pct: number): number {
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}
