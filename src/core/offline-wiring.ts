import {
  JsonTraceSerializer,
  JsonMetricsSerializer,
  JsonLogsSerializer,
} from '@opentelemetry/otlp-transformer';
import { OfflineBuffer, type SignalType, type Storage } from './offline-buffer';
import type { ResolvedOfflineBuffer } from './config';
import type { RetryHooks } from './retry-exporter';
export interface OfflineWiring {
  hooks: {
    traces: RetryHooks;
    metrics: RetryHooks;
    logs: RetryHooks;
  };
  drainAll: (headers: Record<string, string>) => Promise<void>;
}
export function buildOfflineWiring(
  storage: Storage,
  endpoint: string,
  cfg: ResolvedOfflineBuffer,
): OfflineWiring {
  if (!cfg.enabled) {
    return {
      hooks: { traces: {}, metrics: {}, logs: {} },
      drainAll: async () => {},
    };
  }
  const buffer = new OfflineBuffer(storage, cfg.maxItems);
  const hooks = {
    traces: makeHook(buffer, 'traces', (items) =>
      JsonTraceSerializer.serializeRequest(items as never),
    ),
    metrics: makeHook(buffer, 'metrics', (items) =>
      JsonMetricsSerializer.serializeRequest(items as never),
    ),
    logs: makeHook(buffer, 'logs', (items) =>
      JsonLogsSerializer.serializeRequest(items as never),
    ),
  };
  const drainAll = async (headers: Record<string, string>): Promise<void> => {
    await Promise.all(
      (['traces', 'metrics', 'logs'] as SignalType[]).map(async (signal) => {
        try {
          await buffer.drain(signal, `${endpoint}/v1/${signal}`, headers);
        } catch {}
      }),
    );
  };
  return { hooks, drainAll };
}
function makeHook(
  buffer: OfflineBuffer,
  signal: SignalType,
  serialize: (items: unknown) => Uint8Array | undefined,
): RetryHooks {
  return {
    onFailedAfterRetries: (items) => {
      try {
        const arr = Array.isArray(items) ? items : [items];
        const bytes = serialize(arr);
        if (!bytes || bytes.length === 0) return;
        const payload = new TextDecoder().decode(bytes);
        if (payload) void buffer.enqueue(signal, payload, arr.length);
      } catch {}
    },
  };
}
