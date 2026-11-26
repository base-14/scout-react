import type { PlatformAdapter } from './platform';
import { uuidv4 } from './uuid';
const STORAGE_KEY = 'scout.session';
/**
 * Recent sessions with when they started and were last active, so a report
 * delivered launches later (iOS MetricKit) can be put back in the session
 * that was running when it happened.
 */
const HISTORY_KEY = 'scout.session.history';
const HISTORY_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_MAX = 30;
/** `lastActiveAt` is written to the history at most this often. */
const HISTORY_ACTIVE_STEP_MS = 60_000;
/** Covers the throttled `lastActiveAt` and a time rounded down to the minute. */
const HISTORY_MATCH_SLACK_MS = 2 * HISTORY_ACTIVE_STEP_MS;

/** A session as recorded in the history: id, start and last activity (epoch ms). */
export interface SessionRecord {
  id: string;
  s: number;
  e: number;
}

/**
 * The session that was running at `t`: the latest one started by then (within
 * the slack) and still active then. `null` when no recorded session covers it,
 * e.g. a launch killed before the SDK started.
 */
export function sessionAt(history: SessionRecord[], t: number): SessionRecord | null {
  let best: SessionRecord | null = null;
  for (const r of history) {
    if (r.s > t + HISTORY_MATCH_SLACK_MS || t > r.e + HISTORY_MATCH_SLACK_MS) continue;
    if (!best || r.s > best.s) best = r;
  }
  return best;
}
/** Where a session's `sampled` decision came from. */
export type SamplingSource = 'user' | 'fallback';
interface PersistedSession {
  id: string;
  startedAt: number;
  lastActiveAt: number;
  sampled: boolean;
  /**
   * Absent on records written before user-based sampling (read as
   * `fallback`), and on sessions adopted from a WebView host too old to send
   * its decision.
   */
  samplingSource?: SamplingSource;
}
/**
 * Whether a user change should end the current session and start a new one,
 * so the next user never inherits the previous user's sampling decision.
 *
 * Going from anonymous to the first id keeps the session, and so does
 * re-setting the same id. The rotation only happens while user sampling is
 * "in play": the current session was decided by a user value, or a user value
 * is pending. Apps that never use the feature therefore see no extra sessions.
 */
export function shouldRotateOnIdentityChange(
  previousUserId: string | null,
  newUserId: string | null,
  currentSource: SamplingSource | null,
  pending: boolean | null,
): boolean {
  if (previousUserId === null) return false;
  if (newUserId === previousUserId) return false;
  return currentSource === 'user' || pending !== null;
}
export class SessionManager {
  private current: PersistedSession | null = null;
  private timeoutMs: number;
  private maxDurationMs: number;
  private sampleRate: number;
  private onRotate: (() => void) | null = null;
  /**
   * The app-supplied per-user value (`userSampling`). It is read only when a
   * session is created, and never mid-session. `null` means no opinion, so
   * the `sampleRate` roll decides.
   */
  private pendingUserSampling: boolean | null = null;
  /**
   * Set while RUM is disabled (`enabled: false` / `setEnabled(false)`). A
   * suspended manager holds no session and never creates, resumes, extends or
   * persists one; `resume()` is the only way out.
   */
  private suspended = false;
  constructor(
    private platform: PlatformAdapter,
    opts: {
      timeoutMinutes: number;
      sampleRate: number;
      maxDurationMinutes?: number;
    },
  ) {
    this.timeoutMs = opts.timeoutMinutes * 60 * 1000;
    this.maxDurationMs = Math.max(0, opts.maxDurationMinutes ?? 0) * 60 * 1000;
    this.sampleRate = opts.sampleRate;
  }
  setRotationListener(listener: (() => void) | null): void {
    this.onRotate = listener;
  }
  /** Sets the value used at the next session start. Never touches the current session. */
  setPendingUserSampling(value: boolean | null): void {
    this.pendingUserSampling = value;
  }
  get pendingUserSamplingValue(): boolean | null {
    return this.pendingUserSampling;
  }
  async start(): Promise<void> {
    if (this.suspended) return;
    const raw = await safe(() => this.platform.getItem(STORAGE_KEY));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PersistedSession;
        if (parsed.samplingSource !== 'user') parsed.samplingSource = 'fallback';
        const now = Date.now();
        const withinIdle = now - parsed.lastActiveAt < this.timeoutMs;
        const withinLifetime =
          this.maxDurationMs === 0 || now - parsed.startedAt < this.maxDurationMs;
        if (withinIdle && withinLifetime) {
          parsed.lastActiveAt = now;
          this.current = parsed;
          await this.persist();
          return;
        }
      } catch {}
    }
    this.current = this.create();
    await this.persist();
  }
  private create(): PersistedSession {
    const now = Date.now();
    const user = this.pendingUserSampling;
    return {
      id: uuidv4(),
      startedAt: now,
      lastActiveAt: now,
      sampled: user ?? rollPercent() < this.sampleRate,
      samplingSource: user === null ? 'fallback' : 'user',
    };
  }
  get sessionId(): string | null {
    if (this.suspended) return null;
    if (
      this.current &&
      this.maxDurationMs > 0 &&
      Date.now() - this.current.startedAt >= this.maxDurationMs
    ) {
      this.current = this.create();
      void this.persist();
      this.fireRotation();
    }
    return this.current?.id ?? null;
  }
  get startedAtIso(): string | null {
    return this.current ? new Date(this.current.startedAt).toISOString() : null;
  }
  get configuredSampleRate(): number {
    return this.sampleRate;
  }
  private fireRotation(): void {
    if (!this.onRotate) return;
    try {
      this.onRotate();
    } catch {}
  }
  get isSampled(): boolean {
    return this.current?.sampled ?? false;
  }
  /** `null` before hydration, and for sessions adopted from a legacy WebView host. */
  get samplingSource(): SamplingSource | null {
    return this.current?.samplingSource ?? null;
  }
  /**
   * Logs and metrics are dropped only for sessions sampled out by the
   * fallback roll. A user-"no" session still sends them; only its spans are
   * dropped.
   */
  get allowsLogsAndMetrics(): boolean {
    return this.isSampled || this.current?.samplingSource === 'user';
  }
  touch(): void {
    if (this.suspended || !this.current) return;
    this.current.lastActiveAt = Date.now();
    void this.persist();
  }
  /**
   * Binds this page to a host's session. A host that sends its own sampling
   * decision (`sampled`, `samplingSource`) is followed. A host too old to
   * send one keeps the historical behaviour: the page is forced sampled, and
   * no source is recorded.
   */
  adoptExternalSessionId(
    id: string,
    decision?: { sampled?: boolean; samplingSource?: SamplingSource },
  ): void {
    if (!id || this.suspended) return;
    const now = Date.now();
    const hostDecided = typeof decision?.sampled === 'boolean';
    const sampled = hostDecided ? (decision!.sampled as boolean) : true;
    const samplingSource = hostDecided
      ? decision!.samplingSource === 'user'
        ? 'user'
        : 'fallback'
      : undefined;
    if (this.current) {
      this.current.id = id;
      this.current.lastActiveAt = now;
      this.current.sampled = sampled;
      this.current.samplingSource = samplingSource;
    } else {
      this.current = {
        id,
        startedAt: now,
        lastActiveAt: now,
        sampled,
        samplingSource,
      };
    }
    void this.persist();
  }
  async rotate(): Promise<string> {
    if (this.suspended) return '';
    this.current = this.create();
    await this.persist();
    this.fireRotation();
    return this.current.id;
  }
  async maybeRotateOnResume(): Promise<boolean> {
    if (this.suspended) return false;
    if (!this.current) {
      await this.start();
      return true;
    }
    const idle = Date.now() - this.current.lastActiveAt;
    if (idle > this.timeoutMs) {
      await this.rotate();
      return true;
    }
    this.touch();
    return false;
  }
  /** Whether RUM is disabled and no session is held. */
  get isSuspended(): boolean {
    return this.suspended;
  }
  /**
   * Enters the disabled state without reading or writing storage, so a launch
   * that starts disabled leaves any persisted session exactly as it was.
   */
  suspend(): void {
    this.suspended = true;
    this.current = null;
  }
  /**
   * Ends the current session and enters the disabled state. The persisted
   * record is removed, so no later launch can resume the ended session.
   */
  async end(): Promise<void> {
    const hadSession = this.current !== null;
    this.suspend();
    if (hadSession) await safe(() => this.platform.removeItem(STORAGE_KEY));
  }
  /**
   * Leaves the disabled state with a fresh session, its sampling decided like
   * any new session's (the pending user value, else the `sampleRate` roll).
   */
  async resume(): Promise<string> {
    this.suspended = false;
    return this.rotate();
  }
  /** The recorded session that was running at `t` (epoch ms), if any. */
  async sessionAt(t: number): Promise<SessionRecord | null> {
    return sessionAt(await this.loadHistory(), t);
  }

  private history: SessionRecord[] | null = null;

  private async loadHistory(): Promise<SessionRecord[]> {
    if (this.history) return this.history;
    const raw = await safe(() => this.platform.getItem(HISTORY_KEY));
    let parsed: unknown = [];
    try {
      parsed = raw ? JSON.parse(raw) : [];
    } catch {}
    const records = Array.isArray(parsed)
      ? parsed.filter(
          (r): r is SessionRecord =>
            typeof r?.id === 'string' &&
            typeof r?.s === 'number' &&
            typeof r?.e === 'number',
        )
      : [];
    // A write made while this read was in flight wins.
    if (!this.history) this.history = records;
    return this.history;
  }

  /**
   * Records the current session in the history: always when it is new, and
   * at most once a minute for its last activity, so `touch()` on every span
   * doesn't add a second storage write each time.
   */
  private async recordHistory(cur: PersistedSession): Promise<void> {
    const history = await this.loadHistory();
    const entry = history.find((r) => r.id === cur.id);
    if (entry) {
      if (cur.lastActiveAt - entry.e < HISTORY_ACTIVE_STEP_MS) return;
      entry.e = cur.lastActiveAt;
    } else {
      history.push({ id: cur.id, s: cur.startedAt, e: cur.lastActiveAt });
    }
    const cutoff = Date.now() - HISTORY_KEEP_MS;
    const kept = history
      .filter((r) => r.e >= cutoff)
      .sort((a, b) => a.s - b.s)
      .slice(-HISTORY_MAX);
    this.history = kept;
    await safe(() => this.platform.setItem(HISTORY_KEY, JSON.stringify(kept)));
  }

  private async persist(): Promise<void> {
    if (this.suspended || !this.current) return;
    // The session as it is now: a rotation may replace it before the history write.
    const snapshot = { ...this.current };
    await safe(() => this.platform.setItem(STORAGE_KEY, JSON.stringify(snapshot)));
    await this.recordHistory(snapshot);
  }
}
/**
 * A uniform roll in [0, 100) for the fallback sampling decision. Uses the
 * platform CSPRNG when present, as the uuid helper does (and as scout-flutter
 * uses `Random.secure()`), and `Math.random` only on runtimes without
 * `crypto.getRandomValues`.
 */
function rollPercent(): number {
  const c = (
    globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }
  ).crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return (buf[0]! / 0x100000000) * 100;
  }
  return Math.random() * 100;
}
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
