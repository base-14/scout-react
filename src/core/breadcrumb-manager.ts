import type { Breadcrumb } from './types';
import type { PlatformAdapter } from './platform';
const MAX_BREADCRUMBS = 100;
const STORAGE_KEY = 'scout.breadcrumbs';
export class BreadcrumbManager {
  private buffer: Breadcrumb[] = [];
  private orphanedCrumbs: Breadcrumb[] = [];
  private nativeSink: ((json: string) => void) | null = null;
  constructor(private platform: PlatformAdapter) {}
  setNativeSink(sink: ((json: string) => void) | null): void {
    this.nativeSink = sink;
    if (sink) {
      try {
        sink(this.serialize());
      } catch {}
    }
  }
  /**
   * Loads the previous session's persisted crumbs as *orphans* rather than
   * into the live trail: breadcrumbs describe one session, and a crash report
   * drained after restart needs the crumbs from the session that died, not
   * from the one that is only now starting. Retrieve them with
   * [orphaned].
   *
   * The persisted copy is overwritten immediately so a launch that never adds
   * a crumb cannot hand the same orphans out twice.
   */
  async hydrate(): Promise<void> {
    try {
      const raw = await this.platform.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          this.orphanedCrumbs = arr.slice(-MAX_BREADCRUMBS);
        }
      }
    } catch {}
    await this.persist();
  }
  /**
   * The previous session's crumbs. Non-destructive: every report describing
   * that session — the `app_crash` span and any drained native crash report —
   * needs the same trail. They are dropped at the next launch's [hydrate],
   * which has already overwritten the persisted copy.
   */
  orphaned(): Breadcrumb[] {
    return [...this.orphanedCrumbs];
  }
  /** The previous session's crumbs as JSON, or null when there are none. */
  serializeOrphaned(): string | null {
    return this.orphanedCrumbs.length ? JSON.stringify(this.orphanedCrumbs) : null;
  }
  add(type: string, message: string): void {
    const crumb: Breadcrumb = {
      type,
      message,
      time: new Date().toISOString(),
    };
    this.buffer.push(crumb);
    if (this.buffer.length > MAX_BREADCRUMBS) {
      this.buffer.shift();
    }
    void this.persist();
    if (this.nativeSink) {
      try {
        this.nativeSink(this.serialize());
      } catch {}
    }
  }
  list(): Breadcrumb[] {
    return [...this.buffer];
  }
  serialize(): string {
    return JSON.stringify(this.buffer);
  }
  clear(): void {
    this.buffer = [];
    void this.platform.removeItem(STORAGE_KEY).catch(() => {});
  }
  private async persist(): Promise<void> {
    try {
      await this.platform.setItem(STORAGE_KEY, JSON.stringify(this.buffer));
    } catch {}
  }
}
