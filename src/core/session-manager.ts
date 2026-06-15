import type { PlatformAdapter } from './platform';
import { uuidv4 } from './uuid';
const STORAGE_KEY = 'scout.session';
interface PersistedSession {
  id: string;
  startedAt: number;
  lastActiveAt: number;
  sampled: boolean;
}
export class SessionManager {
  private current: PersistedSession | null = null;
  private timeoutMs: number;
  private maxDurationMs: number;
  private sampleRate: number;
  private onRotate: (() => void) | null = null;
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
  async start(): Promise<void> {
    const raw = await safe(() => this.platform.getItem(STORAGE_KEY));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PersistedSession;
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
    return {
      id: uuidv4(),
      startedAt: now,
      lastActiveAt: now,
      sampled: Math.random() * 100 < this.sampleRate,
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
  touch(): void {
    if (!this.current) return;
    this.current.lastActiveAt = Date.now();
    void this.persist();
  }
  adoptExternalSessionId(id: string): void {
    if (!id) return;
    const now = Date.now();
    if (this.current) {
      this.current.id = id;
      this.current.lastActiveAt = now;
      this.current.sampled = true;
    } else {
      this.current = {
        id,
        startedAt: now,
        lastActiveAt: now,
        sampled: true,
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
