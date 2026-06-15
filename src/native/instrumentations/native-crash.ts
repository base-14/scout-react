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
        attrs[ATTR.BREADCRUMBS] = scout.breadcrumbsManager.serialize();
        try {
          const lastScreen = (() => {
            const crumbs = JSON.parse(scout.breadcrumbsManager.serialize());
            for (let i = crumbs.length - 1; i >= 0; i--) {
              const c = crumbs[i];
              if (c?.type === 'navigation' && typeof c.message === 'string') {
                const m = c.message.match(/screen:\s*(.+)/);
                if (m && m[1]) return m[1];
              }
            }
            return null;
          })();
          if (lastScreen) attrs['crash.last_screen'] = lastScreen;
        } catch {}
        if (typeof attrs['crash.error_type'] === 'string' && !attrs[ATTR.CRASH_TYPE]) {
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
interface ScoutCrashApi {
  getPendingCrashes(): Promise<Array<Record<string, unknown>>>;
  clearPendingCrashes(): Promise<void>;
  isInstalled(): Promise<boolean>;
}
