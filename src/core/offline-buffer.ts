export type SignalType = 'traces' | 'metrics' | 'logs';
export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
interface PersistedBatch {
  ts: number;
  payload: string;
  count: number;
}
const KEY_PREFIX = 'scout.offline.';
export class OfflineBuffer {
  constructor(
    private readonly storage: Storage,
    private readonly maxItemsPerSignal: Record<SignalType, number>,
  ) {}
  private keyFor(signal: SignalType): string {
    return `${KEY_PREFIX}${signal}`;
  }
  private async readAll(signal: SignalType): Promise<PersistedBatch[]> {
    try {
      const raw = await this.storage.getItem(this.keyFor(signal));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as PersistedBatch[];
    } catch {
      return [];
    }
  }
  private async writeAll(signal: SignalType, batches: PersistedBatch[]): Promise<void> {
    try {
      if (batches.length === 0) {
        await this.storage.removeItem(this.keyFor(signal));
        return;
      }
      await this.storage.setItem(this.keyFor(signal), JSON.stringify(batches));
    } catch {}
  }
  async enqueue(signal: SignalType, payload: string, count: number): Promise<void> {
    const cap = this.maxItemsPerSignal[signal];
    if (cap <= 0) return;
    const batches = await this.readAll(signal);
    batches.push({ ts: Date.now(), payload, count });
    let total = batches.reduce((sum, b) => sum + b.count, 0);
    while (total > cap && batches.length > 1) {
      const dropped = batches.shift();
      if (dropped) total -= dropped.count;
    }
    await this.writeAll(signal, batches);
  }
  async drain(
    signal: SignalType,
    url: string,
    headers: Record<string, string>,
  ): Promise<{
    sent: number;
    remaining: number;
  }> {
    const batches = await this.readAll(signal);
    if (batches.length === 0) return { sent: 0, remaining: 0 };
    let sent = 0;
    let i = 0;
    for (; i < batches.length; i++) {
      const batch = batches[i]!;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: batch.payload,
        });
        if (!res.ok) break;
        sent += 1;
      } catch {
        break;
      }
    }
    const remaining = batches.slice(i);
    await this.writeAll(signal, remaining);
    return { sent, remaining: remaining.length };
  }
  async size(signal: SignalType): Promise<{
    batches: number;
    items: number;
  }> {
    const batches = await this.readAll(signal);
    return {
      batches: batches.length,
      items: batches.reduce((sum, b) => sum + b.count, 0),
    };
  }
  async clear(signal: SignalType): Promise<void> {
    await this.writeAll(signal, []);
  }
}
