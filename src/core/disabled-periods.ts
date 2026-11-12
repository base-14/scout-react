import type { PlatformAdapter } from './platform';

/** Storage key for the ledger of times RUM was disabled. */
export const DISABLED_PERIODS_KEY = 'scout.disabled_periods';
/** Long enough to outlive MetricKit's delayed (daily) delivery. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PERIODS = 200;

/** A span of wall-clock time (ms) RUM was disabled. `to` is null while still open. */
export interface DisabledPeriod {
  from: number;
  to: number | null;
}

/**
 * Remembers when RUM was disabled, so a crash report persisted by the native
 * crash handlers during that time is dropped instead of replayed by a later,
 * enabled launch.
 *
 * The native handlers (JVM, NDK, exit-info, KSCrash, MetricKit) write their
 * reports independently of JS and cannot know about the switch, so the
 * decision is made at drain time: a report is dropped when its crash time
 * falls inside a recorded period. A period still open at the next launch
 * means that process died while disabled; it is closed at that launch's
 * start, which bounds the death time from above.
 *
 * Nothing is written while RUM stays enabled, so apps that never use the
 * switch never touch this key.
 */
export class DisabledPeriods {
  private periods: DisabledPeriod[] = [];
  private write: Promise<void> = Promise.resolve();

  constructor(private readonly storage: Pick<PlatformAdapter, 'getItem' | 'setItem'>) {}

  /** Reads the ledger and closes any period a previous process left open. */
  async load(now: number = Date.now()): Promise<void> {
    let parsed: DisabledPeriod[] = [];
    try {
      const raw = await this.storage.getItem(DISABLED_PERIODS_KEY);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) parsed = arr.filter(isPeriod);
    } catch {}
    let changed = false;
    for (const p of parsed) {
      if (p.to === null) {
        p.to = Math.max(p.from, now);
        changed = true;
      }
    }
    const kept = prune(parsed, now);
    changed = changed || kept.length !== parsed.length;
    // Anything recorded by this process before load finished stays last.
    this.periods = [...kept, ...this.periods];
    if (changed) await this.persist();
  }

  /** Starts a period at `at`, unless one is already open. */
  async open(at: number = Date.now()): Promise<void> {
    if (this.periods.some((p) => p.to === null)) return;
    this.periods.push({ from: at, to: null });
    this.periods = prune(this.periods, at);
    await this.persist();
  }

  /** Closes the open period at `at`. */
  async close(at: number = Date.now()): Promise<void> {
    const open = this.periods.find((p) => p.to === null);
    if (!open) return;
    open.to = Math.max(open.from, at);
    await this.persist();
  }

  /** Whether `at` falls inside a recorded period (an open one counts up to now). */
  covers(at: number): boolean {
    return this.periods.some((p) => at >= p.from && at <= (p.to ?? Infinity));
  }

  /** Whether any part of `[from, to]` falls inside a recorded period. */
  overlaps(from: number, to: number): boolean {
    return this.periods.some((p) => from <= (p.to ?? Infinity) && to >= p.from);
  }

  list(): DisabledPeriod[] {
    return this.periods.map((p) => ({ ...p }));
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.periods);
    this.write = this.write.then(async () => {
      try {
        await this.storage.setItem(DISABLED_PERIODS_KEY, snapshot);
      } catch {}
    });
    return this.write;
  }
}

function isPeriod(v: unknown): v is DisabledPeriod {
  const p = v as DisabledPeriod;
  return !!p && typeof p.from === 'number' && (p.to === null || typeof p.to === 'number');
}

function prune(periods: DisabledPeriod[], now: number): DisabledPeriod[] {
  const fresh = periods.filter((p) => p.to === null || now - p.to < RETENTION_MS);
  return fresh.slice(-MAX_PERIODS);
}

/**
 * When a pending native crash report says the crash happened: an instant, a
 * window (MetricKit only knows the 24h payload it was delivered in), or
 * nothing usable.
 */
export function crashReportTime(
  report: Record<string, unknown>,
): { at: number } | { from: number; to: number } | null {
  const type = String(report['crash.type'] ?? '');
  if (type.startsWith('metric_kit')) {
    const from = parseTime(report['crash.diagnostic_payload_time_begin']);
    const to = parseTime(report['crash.diagnostic_payload_time_end']);
    if (from !== null && to !== null) return { from, to };
  }
  const death = parseTime(report['crash.death_timestamp_ms']);
  if (death !== null) return { at: death };
  const at = parseTime(report['crash.timestamp']);
  return at !== null ? { at } : null;
}

/**
 * Whether a pending crash report happened while RUM was disabled and must be
 * dropped. A report with no usable time is kept. A MetricKit window is
 * dropped when it overlaps a disabled period at all, since the crash inside
 * it cannot be placed more precisely.
 */
export function crashHappenedWhileDisabled(
  report: Record<string, unknown>,
  periods: Pick<DisabledPeriods, 'covers' | 'overlaps'>,
): boolean {
  const t = crashReportTime(report);
  if (!t) return false;
  return 'at' in t ? periods.covers(t.at) : periods.overlaps(t.from, t.to);
}

/** Epoch ms from a number or numeric string (s, ms or µs), or an ISO-8601 string. */
function parseTime(v: unknown): number | null {
  if (typeof v === 'number') return normalizeEpoch(v);
  if (typeof v !== 'string' || v === '') return null;
  if (/^\d+(\.\d+)?$/.test(v)) return normalizeEpoch(Number(v));
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeEpoch(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1e11) return n * 1000;
  if (n > 1e14) return Math.floor(n / 1000);
  return n;
}
