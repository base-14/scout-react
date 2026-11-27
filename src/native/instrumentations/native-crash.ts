import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import type { Scout } from '../../core/scout';
import type { Release } from '../../core/release-tracers';
import { withSuppression } from '../soft-load';
import {
  METRIC_KIT_CRASH,
  METRIC_KIT_HANG,
  MAX_SESSION_WINDOW_MS,
  PAYLOAD_BEGIN,
  SESSION_AT_CRASH,
  SESSION_AT_DELIVERY,
  asInProcessCrash,
  findDuplicates,
  isInProcessCrash,
  loadRecentInProcessCrashes,
  metricKitReason,
  payloadWindow,
  saveRecentInProcessCrashes,
} from './metrickit';
import {
  asAndroidCrash,
  findExitInfoDuplicates,
  loadRecentAndroidCrashes,
  loadSeenExitRecords,
  saveAndroidState,
  type AndroidCrash,
} from './android-exit';

/**
 * Key the Android exit-info collector sets on a pending report that must be
 * emitted as `app_exit` (a low-memory reclaim) instead of `native_crash`.
 * Mirrors `ScoutExitInfoClassifier.SPAN_KEY`.
 */
export const EXIT_SPAN_KEY = 'scout.span';

/**
 * `crash.*` → `exit.*` for the `app_exit` span shape: the OS reason name
 * becomes `exit.reason`, its description `exit.description`, every other
 * `crash.<k>` keeps its key under the `exit.` prefix. Non-`crash.` keys pass
 * through; an empty `error.stack_trace` (there never is one for an exit) is
 * dropped.
 */
export function toAppExitAttributes(
  attrs: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === ATTR.ERROR_STACK_TRACE && v === '') continue;
    if (k === ATTR.CRASH_TYPE) out['exit.reason'] = v;
    else if (k === ATTR.CRASH_REASON) out['exit.description'] = v;
    else if (k.startsWith('crash.')) out[`exit.${k.slice('crash.'.length)}`] = v;
    else out[k] = v;
  }
  return out;
}

/**
 * The release a report was written by, when it names both its version and
 * build (the iOS signal-handler and Android reports carry no build).
 */
export function releaseOfCrash(report: Record<string, unknown>): Release | null {
  const version = report['crash.app_version'] ?? report['crash.application_version'];
  const build = report['crash.application_build_version'];
  if (typeof version !== 'string' || typeof build !== 'string') return null;
  if (!version.trim() || !build.trim()) return null;
  return { version: version.trim(), build: build.trim() };
}

/** `module` stands in for the native ScoutCrash module in tests. */
export async function installNativeCrashReader(
  scout: Scout,
  module?: ScoutCrashApi | null,
): Promise<void> {
  let ScoutCrash: ScoutCrashApi | null = module ?? null;
  if (module === undefined) {
    try {
      const ExpoModules = withSuppression(() => require('expo-modules-core'));
      ScoutCrash = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash') ?? null;
    } catch {}
  }
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
    // In-process crashes from this drain and earlier ones that MetricKit may
    // still report again, possibly launches later. Recorded before the
    // disabled-period check on purpose: a crash dropped because RUM was off
    // still has a MetricKit copy that must be dropped too.
    const recentInProcess = await loadRecentInProcessCrashes(scout.platformAdapter);
    for (const report of reports) {
      const crash = isInProcessCrash(report) ? asInProcessCrash(report) : null;
      if (crash) recentInProcess.push(crash);
    }
    const enabledReports = reports.filter((r) => !scout.crashHappenedWhileDisabled(r));
    const duplicates = findDuplicates(recentInProcess, enabledReports);
    // Android: the OS's exit-info record of a death the in-process handlers
    // already reported. Recorded the same way, for a record that arrives on a
    // later launch, and also before the disabled-period check: the OS copy of
    // a crash dropped because RUM was off is dropped too.
    const recentAndroid: Array<AndroidCrash & { report?: Record<string, unknown> }> =
      await loadRecentAndroidCrashes(scout.platformAdapter);
    for (const report of reports) {
      const crash = asAndroidCrash(report);
      if (crash) recentAndroid.push({ ...crash, report });
    }
    const seenExitRecords = await loadSeenExitRecords(scout.platformAdapter);
    for (const exit of findExitInfoDuplicates(
      recentAndroid,
      seenExitRecords,
      enabledReports,
    )) {
      duplicates.add(exit);
    }
    for (const report of reports) {
      // Persisted by the native handlers while RUM was disabled: dropped (and
      // cleared below with the rest), never replayed.
      if (scout.crashHappenedWhileDisabled(report)) continue;
      const crashType = String(report['crash.type'] ?? '');
      if (duplicates.has(report)) continue;
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
        const payload = payloadWindow(report);
        if (crashType === METRIC_KIT_CRASH || crashType === METRIC_KIT_HANG) {
          // MetricKit doesn't say which session crashed: take the one running
          // at the payload window, unless the window is too wide to tell.
          // RUM drops crashes without a session, so otherwise the reading
          // session is kept, marked as such.
          const crashed =
            payload && payload.end - payload.begin <= MAX_SESSION_WINDOW_MS
              ? await scout.sessionManager.sessionAt(payload.begin)
              : null;
          if (crashed) {
            common[ATTR.SESSION_ID] = crashed.id;
            common[ATTR.SESSION_START_TIME] = new Date(crashed.s).toISOString();
          }
          attrs['crash.session_source'] = crashed
            ? SESSION_AT_CRASH
            : SESSION_AT_DELIVERY;
        }
        if (crashType === METRIC_KIT_HANG) {
          const durationMs = Number(report['crash.hang_duration_ms'] ?? 0);
          // Hangs in one payload share its start; without a window the
          // delivery time is all there is, and the span says so.
          const startTime = payload ? payload.begin : Date.now() - durationMs;
          scout.emitSpan(
            SPAN.ANR,
            {
              ...attrs,
              [ATTR.ANR_DURATION_MS]: durationMs,
              'anr.source': 'metric_kit',
              'anr.timestamp_source': payload ? PAYLOAD_BEGIN : 'delivery',
              ...common,
            },
            { startTime, endTime: startTime + durationMs },
          );
          continue;
        }
        let startTime: number | undefined;
        if (crashType === METRIC_KIT_CRASH) {
          if (payload) {
            startTime = payload.begin;
            attrs[ATTR.CRASH_TIMESTAMP] = new Date(payload.begin).toISOString();
            // Not the exact crash time, only the start of the window it fell in.
            attrs['crash.timestamp_source'] = PAYLOAD_BEGIN;
          }
          if (!attrs[ATTR.CRASH_REASON])
            attrs[ATTR.CRASH_REASON] = metricKitReason(report);
        }
        // Counted under the release that crashed, not the one reading it.
        const release = releaseOfCrash(report) ?? undefined;
        if (report[EXIT_SPAN_KEY] === SPAN.APP_EXIT) {
          scout.emitSpan(
            SPAN.APP_EXIT,
            { ...toAppExitAttributes(attrs), ...common },
            { release },
          );
        } else {
          scout.emitSpan(
            SPAN.NATIVE_CRASH,
            { ...attrs, ...common },
            startTime === undefined
              ? { release }
              : { startTime, endTime: startTime, release },
          );
        }
      } catch {}
    }
    // Save before clearing: if anything above throws, the reports stay pending
    // and the next drain records them again.
    await saveRecentInProcessCrashes(scout.platformAdapter, recentInProcess);
    await saveAndroidState(scout.platformAdapter, recentAndroid, seenExitRecords);
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

export interface ScoutCrashApi {
  getPendingCrashes(): Promise<Array<Record<string, unknown>>>;
  clearPendingCrashes(): Promise<void>;
  isInstalled(): Promise<boolean>;
}
