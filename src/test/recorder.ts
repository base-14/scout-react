import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan, } from '@opentelemetry/sdk-trace-base';
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor, type ReadableLogRecord, } from '@opentelemetry/sdk-logs';
import { InMemoryMetricExporter, AggregationTemporality, MeterProvider, PeriodicExportingMetricReader, type ResourceMetrics, } from '@opentelemetry/sdk-metrics';
export interface Recorder {
    spans(): ReadableSpan[];
    logs(): ReadableLogRecord[];
    metrics(): Promise<ResourceMetrics[]>;
    reset(): void;
}
export function makeRecorder(): Recorder {
    trace.disable();
    metrics.disable();
    logs.disable();
    const spanExporter = new InMemorySpanExporter();
    const traceProvider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(spanExporter)],
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
