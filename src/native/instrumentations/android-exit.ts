import type { PlatformAdapter } from '../../core/platform';
import { toMs } from './metrickit';

/**
 * Android ApplicationExitInfo crash records, written by
 * ScoutExitInfoCollector in android/.../ScoutCrashModule.kt on the launch
 * after a death. When the in-process handlers (NDK signal handler, JVM
 * uncaught-exception handler) already reported that death, the record is a
 * second copy of the same crash: these helpers find those copies so each
 * crash counts once, and move the OS tombstone onto the in-process report.
 */
export const EXIT_INFO_SOURCE = 'exit_info';

/** In-process crash type each exit-info crash type duplicates. */
const IN_PROCESS_TYPE_OF = new Map<string, string>([
  ['native_crash', 'ndk_signal'],
  ['jvm_crash', 'uncaught_exception'],
]);
const IN_PROCESS_TYPES = new Set(IN_PROCESS_TYPE_OF.values());

const RECENT_KEY = 'scout.android.in_process_crashes';
const SEEN_KEY = 'scout.android.exit_records';
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_KEPT = 50;
/**
 * The OS records the death after the handler wrote its report: 0–3.2 s later
 * in production data. The NDK handler's whole-second timestamp only widens
 * that gap.
 */
const DEATH_AFTER_MS = 10_000;
/**
 * A death recorded before the in-process report's time can only come from
 * the two clocks disagreeing, or from an exit record without
 * death_timestamp_ms falling back to its whole-second crash.timestamp.
 */
const DEATH_BEFORE_MS = 2_000;

/** An in-process crash: time, pid (null when the report has none) and type. */
export interface AndroidCrash {
  t: number;
  p: number | null;
  k: string;
}

/** A crash record from exit info (not a low-memory app exit, not an ANR). */
export function isExitInfoCrash(report: Record<string, unknown>): boolean {
  return (
    report['crash.source'] === EXIT_INFO_SOURCE &&
    IN_PROCESS_TYPE_OF.has(String(report['crash.type'])) &&
    report['scout.span'] === undefined
  );
}

function pidOf(report: Record<string, unknown>): number | null {
  const p = Number(report['crash.pid']);
  return Number.isInteger(p) && p > 0 ? p : null;
}

export function asAndroidCrash(report: Record<string, unknown>): AndroidCrash | null {
  const k = String(report['crash.type']);
  if (!IN_PROCESS_TYPES.has(k) || report['crash.source'] === EXIT_INFO_SOURCE)
    return null;
  const t = toMs(report['crash.timestamp']);
  return t === null ? null : { t, p: pidOf(report), k };
}

function deathOf(report: Record<string, unknown>): number | null {
  return toMs(report['crash.death_timestamp_ms']) ?? toMs(report['crash.timestamp']);
}

/** Identifies one exit record: the OS keeps one per process death. */
function exitKey(report: Record<string, unknown>): string | null {
  const death = deathOf(report);
  return death === null ? null : `${pidOf(report) ?? ''}:${death}`;
}

/**
 * The exit-info crash records to drop: copies of an in-process crash (same
 * kind, same pid where the report has one, death 0–10 s after it) and
 * records already handled on an earlier launch. Each in-process crash
 * absorbs one record. When it absorbs one from this drain, the record's
 * tombstone moves onto the in-process report. `recent` and `seen` are
 * updated in place.
 */
export function findExitInfoDuplicates(
  recent: Array<AndroidCrash & { report?: Record<string, unknown> }>,
  seen: Set<string>,
  reports: Array<Record<string, unknown>>,
): Set<Record<string, unknown>> {
  const drop = new Set<Record<string, unknown>>();
  for (const exit of reports.filter(isExitInfoCrash)) {
    const key = exitKey(exit);
    if (key !== null && seen.has(key)) {
      drop.add(exit);
      continue;
    }
    if (key !== null) seen.add(key);
    const death = deathOf(exit);
    if (death === null) continue;
    const kind = IN_PROCESS_TYPE_OF.get(String(exit['crash.type']));
    const pid = pidOf(exit);
    let best = -1;
    recent.forEach((c, i) => {
      if (c.k !== kind) return;
      if (c.p !== null && pid !== null && c.p !== pid) return;
      const gap = death - c.t;
      if (gap < -DEATH_BEFORE_MS || gap > DEATH_AFTER_MS) return;
      // Prefer a pid match, then the closest in time.
      const better =
        best < 0 ||
        (c.p !== null && recent[best]!.p === null) ||
        ((c.p !== null) === (recent[best]!.p !== null) &&
          Math.abs(gap) < Math.abs(death - recent[best]!.t));
      if (better) best = i;
    });
    if (best < 0) continue;
    const [match] = recent.splice(best, 1);
    const tombstone = exit['crash.tombstone'];
    if (match?.report && tombstone && !match.report['crash.tombstone']) {
      match.report['crash.tombstone'] = tombstone;
    }
    drop.add(exit);
  }
  return drop;
}

async function load<T>(
  platform: PlatformAdapter,
  key: string,
  valid: (v: unknown) => v is T,
): Promise<T[]> {
  try {
    const raw = await platform.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return [];
  }
}

export function loadRecentAndroidCrashes(
  platform: PlatformAdapter,
): Promise<AndroidCrash[]> {
  return load(
    platform,
    RECENT_KEY,
    (c): c is AndroidCrash =>
      typeof (c as AndroidCrash)?.t === 'number' &&
      typeof (c as AndroidCrash)?.k === 'string' &&
      ((c as AndroidCrash).p === null || Number.isInteger((c as AndroidCrash).p)),
  );
}

export async function loadSeenExitRecords(
  platform: PlatformAdapter,
): Promise<Set<string>> {
  const entries = await load(
    platform,
    SEEN_KEY,
    (e): e is [string, number] =>
      Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number',
  );
  return new Set(entries.map(([key]) => key));
}

/**
 * Failures are not raised on purpose: an error here would skip
 * clearPendingCrashes and re-send every report of this drain on the next
 * launch, while lost state can at worst let one re-delivered exit record
 * through.
 */
export async function saveAndroidState(
  platform: PlatformAdapter,
  recent: AndroidCrash[],
  seen: Set<string>,
): Promise<void> {
  const cutoff = Date.now() - KEEP_MS;
  const kept = recent
    .filter((c) => c.t >= cutoff)
    .map(({ t, p, k }) => ({ t, p, k }))
    .sort((a, b) => a.t - b.t)
    .slice(-MAX_KEPT);
  const seenKept = [...seen]
    .map((key): [string, number] => [key, Number(key.split(':')[1])])
    .filter(([, death]) => death >= cutoff)
    .sort((a, b) => a[1] - b[1])
    .slice(-MAX_KEPT);
  try {
    await platform.setItem(RECENT_KEY, JSON.stringify(kept));
    await platform.setItem(SEEN_KEY, JSON.stringify(seenKept));
  } catch {}
}
