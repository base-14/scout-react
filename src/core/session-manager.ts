import type { PlatformAdapter } from './platform';
import { uuidv4 } from './uuid';
const STORAGE_KEY = 'scout.session';
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
      sampled: user ?? Math.random() * 100 < this.sampleRate,
      samplingSource: user === null ? 'fallback' : 'user',
    };
  }
  get sessionId(): string | null {
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
    if (!this.current) return;
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
    if (!id) return;
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
    this.current = this.create();
    await this.persist();
    this.fireRotation();
    return this.current.id;
  }
  async maybeRotateOnResume(): Promise<boolean> {
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
  private async persist(): Promise<void> {
    if (!this.current) return;
    await safe(() => this.platform.setItem(STORAGE_KEY, JSON.stringify(this.current)));
  }
}
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
