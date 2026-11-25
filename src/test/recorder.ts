import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { Resource } from '@opentelemetry/resources';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import {
  InMemoryMetricExporter,
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
export interface Recorder {
  spans(): ReadableSpan[];
  logs(): ReadableLogRecord[];
  metrics(): Promise<ResourceMetrics[]>;
  reset(): void;
  /** The span pipeline, so a test can attach another provider to it. */
  spanProcessors: SpanProcessor[];
}
export function makeRecorder(opts: { resource?: Resource } = {}): Recorder {
  trace.disable();
  metrics.disable();
  logs.disable();
  const spanExporter = new InMemorySpanExporter();
  const spanProcessors: SpanProcessor[] = [new SimpleSpanProcessor(spanExporter)];
  const traceProvider = new BasicTracerProvider({
    ...(opts.resource ? { resource: opts.resource } : {}),
    spanProcessors,
  });
  trace.setGlobalTracerProvider(traceProvider);
  const logExporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(logExporter)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const meterProvider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 1000000,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);
  return {
    spanProcessors,
    spans: () => spanExporter.getFinishedSpans(),
    logs: () => logExporter.getFinishedLogRecords(),
    metrics: async () => {
      await meterProvider.forceFlush();
      return metricExporter.getMetrics();
    },
    reset: () => {
      spanExporter.reset();
      logExporter.reset();
      metricExporter.reset();
    },
  };
}
export function memoryPlatform() {
  const store = new Map<string, string>();
  return {
    name: 'web' as const,
    async getItem(k: string) {
      return store.get(k) ?? null;
    },
    async setItem(k: string, v: string) {
      store.set(k, v);
    },
    async removeItem(k: string) {
      store.delete(k);
    },
    async collectResourceAttributes() {
      return {};
    },
    getConnectionType() {
      return 'unknown';
    },
  };
}
