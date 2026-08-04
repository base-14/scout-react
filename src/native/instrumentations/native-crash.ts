import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
export async function installNativeCrashReader(scout: Scout): Promise<void> {
  let ScoutCrash: ScoutCrashApi | null = null;
  try {
    const ExpoModules = withSuppression(() => require('expo-modules-core'));
    ScoutCrash = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
  } catch {}
  if (!ScoutCrash) return;
  try {
    const reports = await ScoutCrash.getPendingCrashes();
    if (!reports || reports.length === 0) return;
    // Crumbs from the session that crashed. The NDK path bakes its own into
    // the report at signal time; the JVM and exit-info paths have none, and
    // the current in-memory trail belongs to the session that just started.
    const orphanedCrumbs = scout.breadcrumbsManager.orphaned();
    const orphanedJson = scout.breadcrumbsManager.serializeOrphaned();
    const drainProvenance = await collectDrainProvenance();
    for (const report of reports) {
      try {
        const attrs: Record<string, string | number | boolean> = {
          [ATTR.CRASH_TYPE]: String(report['crash.type'] ?? 'unknown'),
          [ATTR.CRASH_REASON]: String(report['crash.reason'] ?? ''),
          [ATTR.ERROR_STACK_TRACE]: String(report['crash.stack_trace'] ?? ''),
        };
        for (const [k, v] of Object.entries(report)) {
          if (!k.startsWith('crash.')) continue;
          if (k === 'crash.type' || k === 'crash.reason' || k === 'crash.stack_trace')
            continue;
          if (v === undefined || v === null) continue;
          if (typeof v === 'string') {
            if (v === '') continue;
            attrs[k] = v;
          } else if (typeof v === 'number' || typeof v === 'boolean') {
            attrs[k] = v;
          } else {
            attrs[k] = String(v);
          }
        }
        // Only fall back to the orphaned trail when the report carries none
        // of its own.
        const ownCrumbs = attrs['crash.breadcrumbs'];
        const hasOwnCrumbs = typeof ownCrumbs === 'string' && ownCrumbs.length > 2;
        if (!hasOwnCrumbs && orphanedJson) {
          attrs[ATTR.BREADCRUMBS] = orphanedJson;
        }
        try {
          const crumbs = hasOwnCrumbs
            ? (JSON.parse(ownCrumbs as string) as Array<{
                type?: string;
                message?: string;
              }>)
            : orphanedCrumbs;
          const lastScreen = lastScreenOf(crumbs);
          if (lastScreen) attrs['crash.last_screen'] = lastScreen;
        } catch {}
        Object.assign(attrs, drainProvenance);
        if (typeof attrs['crash.error_type'] === 'string' && attrs['crash.error_type']) {
          attrs[ATTR.CRASH_TYPE] = attrs['crash.error_type'];
        }
        delete attrs['crash.error_type'];
        const common = scout.commonAttributes();
        const crashedSessionId =
          (report['crash.previous_session_id'] as string | undefined) ??
          (report['crash.session_id'] as string | undefined);
        const crashedSessionStart =
          (report['crash.session_started_at'] as string | undefined) ??
          (report['crash.started_at'] as string | undefined);
        if (crashedSessionId) {
          common[ATTR.SESSION_ID] = crashedSessionId;
        }
        if (crashedSessionStart) {
          common[ATTR.SESSION_START_TIME] = crashedSessionStart;
        }
        scout.emitSpan(SPAN.NATIVE_CRASH, { ...attrs, ...common });
      } catch {}
    }
    await ScoutCrash.clearPendingCrashes();
  } catch {}
}
function lastScreenOf(
  crumbs: Array<{ type?: string; message?: string }> | undefined,
): string | null {
  if (!Array.isArray(crumbs)) return null;
  for (let i = crumbs.length - 1; i >= 0; i--) {
    const c = crumbs[i];
    if (c?.type === 'navigation' && typeof c.message === 'string') {
      const m = c.message.match(/screen:\s*(.+)/);
      if (m && m[1]) return m[1];
    }
  }
  return null;
}

/**
 * Describes the *drain*, not the crash: which app state the report was
 * recovered in, and how long the recovering process had been up. Makes it
 * possible to tell a report drained seconds after relaunch from one that sat
 * on disk across several launches.
 */
async function collectDrainProvenance(): Promise<Record<string, string | number>> {
  const out: Record<string, string | number> = {};
  try {
    const RN = withSuppression(() => require('react-native'));
    const state = RN?.AppState?.currentState;
    if (typeof state === 'string' && state) out[ATTR.CRASH_DRAIN_APP_STATE] = state;
  } catch {}
  try {
    const ExpoModules = withSuppression(() => require('expo-modules-core'));
    const mod: { getProcessStartTimeMillis?: () => Promise<number> } | null =
      ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
    if (typeof mod?.getProcessStartTimeMillis === 'function') {
      const startMs = await mod.getProcessStartTimeMillis();
      if (typeof startMs === 'number' && Number.isFinite(startMs) && startMs > 0) {
        out[ATTR.CRASH_DRAIN_PROCESS_START_TIME] = new Date(startMs).toISOString();
        out[ATTR.CRASH_DRAIN_UPTIME_SECS] = (Date.now() - startMs) / 1000;
      }
    }
  } catch {}
  return out;
}

interface ScoutCrashApi {
  getPendingCrashes(): Promise<Array<Record<string, unknown>>>;
  clearPendingCrashes(): Promise<void>;
  isInstalled(): Promise<boolean>;
}
