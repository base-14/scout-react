import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import {
  JsonTraceSerializer,
  JsonMetricsSerializer,
  JsonLogsSerializer,
} from '@opentelemetry/otlp-transformer';
import {
  AggregationTemporality,
  AggregationType,
  type AggregationOption,
  type InstrumentType,
  type PushMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';

/**
 * OTLP/JSON exporters that deliver a batch **at most once**.
 *
 * The stock `@opentelemetry/exporter-*-otlp-http` exporters wrap their
 * transport in `RetryingTransport`, which re-sends up to 5 more times on
 * 429/502/503/504 and on network errors. Stacked under our own
 * `wrapWithRetry`, one batch could reach the collector ~20 times — the
 * duplicate-span-ID bug scout-flutter fixed in 0.1.22 by owning the
 * exporter outright (`lib/src/fixed_http_span_exporter.dart`).
 *
 * One `export()` call here is exactly one `fetch()`. Retry policy lives in
 * exactly one place: `wrapWithRetry` (`src/core/retry-exporter.ts`), which
 * is off by default.
 */
export interface OtlpExporterOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMillis?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

class OtlpHttpError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`OTLP export failed with status ${status}${body ? `: ${body}` : ''}`);
    this.name = 'OtlpHttpError';
    this.status = status;
  }
}

/**
 * POSTs one serialized OTLP/JSON payload. Resolves on 2xx, rejects otherwise.
 *
 * Errors carry `.status` for non-2xx responses so `isRetryableError` in
 * retry-exporter.ts classifies them exactly as it did for the stock
 * exporters; transport failures surface their original message, which that
 * same classifier matches on (`network|abort|timeout|fetch|ECONN...`).
 */
export async function sendOtlpJson(
  url: string,
  payload: string,
  headers: Record<string, string>,
  timeoutMillis: number,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMillis);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: payload,
      signal: controller.signal,
    });
    if (res.status >= 200 && res.status < 300) return;
    let body = '';
    try {
      body = (await res.text()).slice(0, 200);
    } catch {}
    throw new OtlpHttpError(res.status, body);
  } finally {
    clearTimeout(timer);
  }
}

interface Serializer<T> {
  serializeRequest(request: T): Uint8Array | undefined;
}

/**
 * Builds the `export(items, callback)` half shared by all three signals.
 * Kept generic so trace/metric/log exporters cannot drift apart.
 */
function createExportFn<T>(
  serializer: Serializer<T>,
  opts: OtlpExporterOptions,
  isShutdown: () => boolean,
): (items: T, resultCallback: (result: ExportResult) => void) => void {
  const headers = opts.headers ?? {};
  const timeoutMillis = opts.timeoutMillis ?? DEFAULT_TIMEOUT_MS;
  return (items, resultCallback) => {
    if (isShutdown()) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error('exporter has been shut down'),
      });
      return;
    }
    let payload: string;
    try {
      const bytes = serializer.serializeRequest(items);
      if (!bytes || bytes.length === 0) {
        resultCallback({ code: ExportResultCode.SUCCESS });
        return;
      }
      payload = new TextDecoder().decode(bytes);
    } catch (error) {
      resultCallback({ code: ExportResultCode.FAILED, error: asError(error) });
      return;
    }
    sendOtlpJson(opts.url, payload, headers, timeoutMillis).then(
      () => resultCallback({ code: ExportResultCode.SUCCESS }),
      (error: unknown) =>
        resultCallback({ code: ExportResultCode.FAILED, error: asError(error) }),
    );
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createOtlpTraceExporter(opts: OtlpExporterOptions): SpanExporter {
  let shutdown = false;
  const doExport = createExportFn<ReadableSpan[]>(
    JsonTraceSerializer,
    opts,
    () => shutdown,
  );
  return {
    export: (spans, resultCallback) => doExport(spans, resultCallback),
    forceFlush: async () => {},
    shutdown: async () => {
      shutdown = true;
    },
  };
}

export function createOtlpLogExporter(opts: OtlpExporterOptions): LogRecordExporter {
  let shutdown = false;
  const doExport = createExportFn<ReadableLogRecord[]>(
    JsonLogsSerializer,
    opts,
    () => shutdown,
  );
  return {
    export: (logs, resultCallback) => doExport(logs, resultCallback),
    forceFlush: async () => {},
    shutdown: async () => {
      shutdown = true;
    },
  };
}

const DEFAULT_AGGREGATION: AggregationOption = { type: AggregationType.DEFAULT };

export function createOtlpMetricExporter(opts: OtlpExporterOptions): PushMetricExporter {
  let shutdown = false;
  const doExport = createExportFn<ResourceMetrics>(
    JsonMetricsSerializer,
    opts,
    () => shutdown,
  );
  return {
    export: (metrics, resultCallback) => doExport(metrics, resultCallback),
    // Cumulative is what OTLPMetricExporter defaults to; anything else
    // would silently change what the backend stores.
    selectAggregationTemporality: (_instrumentType: InstrumentType) =>
      AggregationTemporality.CUMULATIVE,
    selectAggregation: (_instrumentType: InstrumentType) => DEFAULT_AGGREGATION,
    forceFlush: async () => {},
    shutdown: async () => {
      shutdown = true;
    },
  };
}
