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
                    ...optional('crash.signal_address', report),
                    ...optional('crash.mach_exception', report),
                    ...optional('crash.mach_code', report),
                    ...optional('crash.nsexception_name', report),
                    ...optional('crash.thread', report),
                    ...optional('crash.timestamp', report),
                    ...optional('crash.exception_type', report),
                    ...optional('crash.exception_code', report),
                    ...optional('crash.termination_reason', report),
                    ...optional('crash.application_version', report),
                    ...optional('crash.application_build_version', report),
                    ...optional('crash.os_version', report),
                    ...optional('crash.device_type', report),
                    ...optional('crash.region_format', report),
                    ...optional('crash.diagnostic_payload_time_begin', report),
                    ...optional('crash.diagnostic_payload_time_end', report),
                    ...optional('crash.hang_duration_ms', report),
                    ...optional('crash.callstack_tree_json', report),
                    ...optional('crash.report_id', report),
                    ...optional('crash.error_type', report),
                    ...optional('crash.queue', report),
                    ...optional('crash.registers_json', report),
                    ...optional('crash.binary_images_json', report),
                    ...optional('crash.machine', report),
                    ...optional('crash.device_model', report),
                    ...optional('crash.cpu_arch', report),
                    ...optional('crash.build_type', report),
                    ...optional('crash.bundle_id', report),
                    ...optional('crash.kernel_version', report),
                    ...optional('crash.os_name', report),
                    ...optional('crash.ppid', report),
                    ...optional('crash.cpp_exception_name', report),
                    ...optional('crash.fault_address_register', report),
                    ...optional('crash.exception_syndrome_register', report),
                    ...optional('crash.os_reason_code', report),
                    ...optional('crash.os_reason_name', report),
                    ...optional('crash.subreason', report),
                    ...optional('crash.exit_status', report),
                    ...optional('crash.death_timestamp_ms', report),
                    ...optional('crash.process_name', report),
                    ...optional('crash.pid', report),
                    ...optional('crash.importance', report),
                    ...optional('crash.pss_kb', report),
                    ...optional('crash.rss_kb', report),
                    ...optional('crash.tombstone', report),
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
