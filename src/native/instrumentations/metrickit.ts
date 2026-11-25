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

/** An in-process crash not yet matched to a MetricKit report. */
export interface InProcessCrash {
  t: number;
  v: string | null;
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
  return t === null ? null : { t, v: versionOf(report) };
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

/**
 * Removes and returns true for the first in-process crash this MetricKit
 * report duplicates: same app version (when both know it) and a crash time
 * inside the payload window. Each in-process crash absorbs one report.
 */
export function absorbDuplicate(
  recent: InProcessCrash[],
  report: Record<string, unknown>,
): boolean {
  const window = payloadWindow(report);
  if (!window) return false;
  const version = versionOf(report);
  const i = recent.findIndex(
    (c) =>
      c.t >= window.begin - WINDOW_SLACK_MS &&
      c.t <= window.end + WINDOW_SLACK_MS &&
      (c.v === null || version === null || c.v === version),
  );
  if (i < 0) return false;
  recent.splice(i, 1);
  return true;
}

/** A grouping reason: the termination reason, else exception type and signal. */
export function metricKitReason(report: Record<string, unknown>): string {
  const termination = report['crash.termination_reason'];
  if (typeof termination === 'string' && termination !== '') return termination;
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
  const kept = recent.filter((c) => c.t >= cutoff).slice(-MAX_KEPT);
  try {
    await platform.setItem(RECENT_KEY, JSON.stringify(kept));
  } catch {}
}
