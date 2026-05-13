import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { withSuppression } from '../soft-load';
export async function installNativeCrashReader(scout: Scout): Promise<void> {
    let ScoutCrash: ScoutCrashApi | null = null;
    try {
        const ExpoModules = withSuppression(() => require('expo-modules-core'));
        ScoutCrash = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
    }
    catch {
    }
    if (!ScoutCrash)
        return;
    try {
        const reports = await ScoutCrash.getPendingCrashes();
        if (!reports || reports.length === 0)
            return;
        for (const report of reports) {
            try {
                scout.emitSpan(SPAN.NATIVE_CRASH, {
                    [ATTR.CRASH_TYPE]: String(report['crash.type'] ?? 'unknown'),
                    [ATTR.CRASH_REASON]: String(report['crash.reason'] ?? ''),
                    [ATTR.ERROR_STACK_TRACE]: String(report['crash.stack_trace'] ?? ''),
                    ...optional('crash.signal_code', report),
                    ...optional('crash.signal', report),
                    ...optional('crash.mach_exception', report),
                    ...optional('crash.mach_code', report),
                    ...optional('crash.nsexception_name', report),
                    ...optional('crash.thread', report),
                    ...optional('crash.timestamp', report),
                    [ATTR.BREADCRUMBS]: scout.breadcrumbsManager.serialize(),
                    ...scout.commonAttributes(),
                });
            }
            catch {
            }
        }
        await ScoutCrash.clearPendingCrashes();
    }
    catch {
    }
}
interface ScoutCrashApi {
    getPendingCrashes(): Promise<Array<Record<string, unknown>>>;
    clearPendingCrashes(): Promise<void>;
    isInstalled(): Promise<boolean>;
}
function optional(key: string, source: Record<string, unknown>): Record<string, string> {
    const v = source[key];
    if (v === undefined || v === null || v === '')
        return {};
    return { [key]: String(v) };
}
