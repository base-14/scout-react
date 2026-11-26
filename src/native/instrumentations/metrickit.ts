import type { PlatformAdapter } from '../../core/platform';

/**
 * iOS MetricKit reports, written by ios/ScoutCrashModule.swift. MetricKit
 * delivers late (next launch at best) and only carries the time window of
 * its payload, so these helpers decide which reports are copies of crashes
 * the in-process handlers already caught, and where the rest belong.
 */
export const METRIC_KIT_CRASH = 'metric_kit_crash';
export const METRIC_KIT_HANG = 'metric_kit_hang';

/** Crash types written in-process at crash time (KSCrash, signal handler, NSException). */
const IN_PROCESS_TYPES = new Set(['kscrash', 'signal', 'nsexception']);

const RECENT_KEY = 'scout.ios.in_process_crashes';
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_KEPT = 50;
/** Slack around the payload window, for clock and rounding differences. */
const WINDOW_SLACK_MS = 60_000;
/** `crash.timestamp_source` on a MetricKit crash: the time is its payload window's start. */
export const PAYLOAD_BEGIN = 'metric_kit_payload_begin';
/** `crash.session_source`: the session recorded as running at the crash window. */
export const SESSION_AT_CRASH = 'crash_time';
/** `crash.session_source`: no recorded session covers the crash; the reading one is used. */
export const SESSION_AT_DELIVERY = 'delivery';

const SIGABRT = 6;
const SIGKILL = 9;
/**
 * Terminations the OS performs from outside the process (watchdog, resource
 * and thermal kills). No in-process handler can catch them, so a MetricKit
 * report of one is never a duplicate.
 */
const EXTERNAL_TERMINATION =
  /0x8badf00d|0xdead10cc|0xc00010ff|0xbad22222|0xbaadca11|SPRINGBOARD|RUNNINGBOARD|FRONTBOARD|watchdog/i;

/**
 * An in-process crash not yet matched to a MetricKit report: time, app
 * version, signal number and crash type. Entries saved by earlier versions
 * have no signal or type; they match any signal.
 */
export interface InProcessCrash {
  t: number;
  v: string | null;
  s?: number | null;
  k?: string | null;
}

const EXCEPTION_TYPES: Record<string, string> = {
  '1': 'EXC_BAD_ACCESS',
  '2': 'EXC_BAD_INSTRUCTION',
  '3': 'EXC_ARITHMETIC',
  '4': 'EXC_EMULATION',
  '5': 'EXC_SOFTWARE',
  '6': 'EXC_BREAKPOINT',
  '10': 'EXC_CRASH',
  '11': 'EXC_RESOURCE',
  '12': 'EXC_GUARD',
  '13': 'EXC_CORPSE_NOTIFY',
};

const SIGNALS: Record<string, string> = {
  '4': 'SIGILL',
  '5': 'SIGTRAP',
  '6': 'SIGABRT',
  '7': 'SIGEMT',
  '8': 'SIGFPE',
  '9': 'SIGKILL',
  '10': 'SIGBUS',
  '11': 'SIGSEGV',
  '12': 'SIGSYS',
  '13': 'SIGPIPE',
  '15': 'SIGTERM',
};

const SIGNAL_NUMBERS: Record<string, number> = Object.fromEntries(
  Object.entries(SIGNALS).map(([n, name]) => [name, Number(n)]),
);

/** Signal number from a name (`SIGSEGV`, written in-process) or a number (MetricKit). */
function signalNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v !== 'string' || v === '') return null;
  if (/^\d+$/.test(v)) return Number(v);
  return SIGNAL_NUMBERS[v.toUpperCase()] ?? null;
}

// Every writer in ios/ stores ISO 8601 strings with a zone; numbers are
// taken as epoch milliseconds.
function toMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string' || v === '') return null;
  const numeric = Number(v);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : null;
}

function versionOf(report: Record<string, unknown>): string | null {
  const v = report['crash.app_version'] ?? report['crash.application_version'];
  return typeof v === 'string' && v !== '' ? v : null;
}

export function isInProcessCrash(report: Record<string, unknown>): boolean {
  return IN_PROCESS_TYPES.has(String(report['crash.type']));
}

export function asInProcessCrash(report: Record<string, unknown>): InProcessCrash | null {
  const t = toMs(report['crash.timestamp']);
  if (t === null) return null;
  const k = String(report['crash.type']);
  // An uncaught NSException ends in abort().
  const s =
    signalNumber(report['crash.signal']) ?? (k === 'nsexception' ? SIGABRT : null);
  return { t, v: versionOf(report), s, k };
}

/** The payload window a MetricKit diagnostic was collected in. */
export function payloadWindow(
  report: Record<string, unknown>,
): { begin: number; end: number } | null {
  const begin = toMs(report['crash.diagnostic_payload_time_begin']);
  const end = toMs(report['crash.diagnostic_payload_time_end']);
  if (begin === null || end === null || end < begin) return null;
  return { begin, end };
}

/** Killed from outside the process: SIGKILL or a watchdog-style termination. */
function terminatedExternally(report: Record<string, unknown>): boolean {
  if (signalNumber(report['crash.signal']) === SIGKILL) return true;
  const reason = report['crash.termination_reason'];
  return typeof reason === 'string' && EXTERNAL_TERMINATION.test(reason);
}

/**
 * Removes and returns true for the in-process crash this MetricKit report
 * duplicates: crash time inside the payload window, same app version and
 * signal where both sides know them. A crash with the same signal is
 * preferred over one whose signal is unknown. Each in-process crash absorbs
 * one report; external terminations are never absorbed.
 */
export function absorbDuplicate(
  recent: InProcessCrash[],
  report: Record<string, unknown>,
): boolean {
  if (terminatedExternally(report)) return false;
  const payload = payloadWindow(report);
  if (!payload) return false;
  const version = versionOf(report);
  const signal = signalNumber(report['crash.signal']);
  const candidates = recent
    .map((c, i) => ({ c, i }))
    .filter(
      ({ c }) =>
        c.t >= payload.begin - WINDOW_SLACK_MS &&
        c.t <= payload.end + WINDOW_SLACK_MS &&
        (c.v === null || version === null || c.v === version) &&
        (c.s == null || signal === null || c.s === signal),
    );
  const best = candidates.find(({ c }) => c.s != null && c.s === signal) ?? candidates[0];
  if (!best) return false;
  recent.splice(best.i, 1);
  return true;
}

/**
 * The MetricKit crash reports that duplicate in-process crashes. Reports with
 * a known signal are matched first, so one without a signal can't take the
 * in-process crash that a same-signal report would have matched.
 */
export function findDuplicates(
  recent: InProcessCrash[],
  reports: Array<Record<string, unknown>>,
): Set<Record<string, unknown>> {
  const metricKit = reports.filter((r) => r['crash.type'] === METRIC_KIT_CRASH);
  const knownSignal = (r: Record<string, unknown>) =>
    signalNumber(r['crash.signal']) !== null;
  const ordered = [
    ...metricKit.filter(knownSignal),
    ...metricKit.filter((r) => !knownSignal(r)),
  ];
  return new Set(ordered.filter((r) => absorbDuplicate(recent, r)));
}

const WATCHDOG = /0x8badf00d/i;

/** Watchdog causes by the phrase RunningBoard uses in the termination reason. */
const WATCHDOG_CAUSES: Array<[RegExp, string]> = [
  [/scene-create watchdog/i, 'scene-create timeout'],
  [/scene-update watchdog/i, 'scene-update timeout'],
  [/failed to terminate gracefully/i, 'failed to terminate'],
];

/**
 * A termination reason without the parts that differ on every report:
 * bundle and process ids, UUIDs, long hex values and measured times. Only
 * the first line is kept; the full text stays in `crash.termination_reason`.
 */
function stableTermination(reason: string): string {
  return reason
    .split('\n')[0]!
    .replace(/<RBSTerminateContext\|\s*/i, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    .replace(/app<[^>]*>(:\d+)?/gi, 'app')
    .replace(/\[app[^\]]*\]/gi, 'app')
    .replace(/\b0x[0-9a-f]{9,}\b/gi, '0x…')
    .replace(/\d+\.\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * A grouping reason that is the same for every report of one cause: a
 * watchdog cause, else the termination reason without per-report ids, else
 * exception type and signal.
 */
export function metricKitReason(report: Record<string, unknown>): string {
  const termination = report['crash.termination_reason'];
  if (typeof termination === 'string' && termination !== '') {
    if (WATCHDOG.test(termination)) {
      const cause = WATCHDOG_CAUSES.find(([re]) => re.test(termination));
      return cause ? `Watchdog: ${cause[1]}` : 'Watchdog termination';
    }
    const stable = stableTermination(termination);
    if (stable) return stable;
  }
  const exception = String(report['crash.exception_type'] ?? '');
  const signal = String(report['crash.signal'] ?? '');
  const exceptionName =
    EXCEPTION_TYPES[exception] ?? (exception ? `exception ${exception}` : '');
  const signalName = SIGNALS[signal] ?? (signal ? `signal ${signal}` : '');
  if (exceptionName && signalName) return `${exceptionName} (${signalName})`;
  return exceptionName || signalName;
}

export async function loadRecentInProcessCrashes(
  platform: PlatformAdapter,
): Promise<InProcessCrash[]> {
  try {
    const raw = await platform.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is InProcessCrash =>
        typeof c?.t === 'number' && (typeof c?.v === 'string' || c?.v === null),
    );
  } catch {
    return [];
  }
}

export async function saveRecentInProcessCrashes(
  platform: PlatformAdapter,
  recent: InProcessCrash[],
): Promise<void> {
  const cutoff = Date.now() - KEEP_MS;
  const kept = recent
    .filter((c) => c.t >= cutoff)
    .sort((a, b) => a.t - b.t)
    .slice(-MAX_KEPT);
  try {
    await platform.setItem(RECENT_KEY, JSON.stringify(kept));
  } catch {}
}
