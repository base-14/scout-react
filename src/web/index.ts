import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { trace, metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, } from '@opentelemetry/semantic-conventions';
import { Scout as ScoutCore } from '../core/scout';
import { resolveConfig, resolveEndpoint, type ScoutConfig } from '../core/config';
import { wrapWithRetry } from '../core/retry-exporter';
import { buildOfflineWiring } from '../core/offline-wiring';
import type { Attributes, AttributeValue } from '../core/types';
import { ATTR } from '../core/attributes';
import { WebPlatform } from './platform';
import { installTapTracker } from './instrumentations/tap';
import { installErrorTracker } from './instrumentations/error';
import { installLifecycleTracker } from './instrumentations/lifecycle';
import { installRouteTracker } from './instrumentations/route';
import { installStartupTracker } from './instrumentations/startup';
import { installLongTaskTracker } from './instrumentations/long-task';
import { installMemoryTracker } from './instrumentations/memory';
import { installWebVitalsTracker } from './instrumentations/web-vitals';
import { installNetworkTracker } from './instrumentations/network';
import { installCrashDetector } from './instrumentations/crash';
import { installConsoleCapture } from './instrumentations/console';
import { installAnrDetector } from './instrumentations/anr';
import { installFrameMetricsTracker } from './instrumentations/frame-metrics';
import { installBatteryTracker } from './instrumentations/battery';
import { emitScoutConfigLog, emitScoutUsageOnce } from '../core/telemetry';
import { installFrustrationTracker } from './instrumentations/frustration';
import { installScrollDepthTracker } from './instrumentations/scroll';
import { installPageStateTracker } from './instrumentations/page-states';
import { installCspViolationTracker } from './instrumentations/csp';
import { startPerformanceBuffer } from './performance-buffer';
export { ATTR } from '../core/attributes';
export { SPAN, BREADCRUMB_TYPE } from '../core/spans';
export { METRIC } from '../core/metrics';
export { ScoutCore };
export type { Attributes, AttributeValue, BeforeSendCallback, BeforeSendEvent, Breadcrumb, SeverityText, } from '../core/types';
export type { ScoutConfig } from '../core/config';
let _instance: ScoutCore | null = null;
const _disposers: Array<() => void> = [];
export const Scout = {
    async initialize(config: ScoutConfig): Promise<void> {
        if (_instance)
            return;
        const resolved = resolveConfig(config);
        const endpoint = resolveEndpoint(resolved.endpoint, resolved.secure);
        const platform = new WebPlatform();
        const offline = buildOfflineWiring(platform, endpoint, resolved.offlineBuffer);
        const baseAttrs = await platform.collectResourceAttributes();
        const resource = resourceFromAttributes({
            [ATTR_SERVICE_NAME]: resolved.serviceName,
            [ATTR_SERVICE_VERSION]: resolved.serviceVersion,
            ...(resolved.environment ? { environment: resolved.environment } : {}),
            ...(resolved.applicationId
                ? { [ATTR.APPLICATION_ID]: resolved.applicationId }
                : {}),
            ...(resolved.buildId ? { [ATTR.APP_BUILD_ID]: resolved.buildId } : {}),
            ...baseAttrs,
            ...((resolved.resourceAttributes as Record<string, any>) ?? {}),
        });
        const headers = resolved.headers ?? {};
        const traceExporter = wrapWithRetry(new OTLPTraceExporter({
            url: `${endpoint}/v1/traces`,
            headers,
            timeoutMillis: resolved.exportTimeoutMs,
        }), resolved.exportRetry, offline.hooks.traces);
        const traceProvider = new WebTracerProvider({
            resource,
            spanProcessors: [
                new BatchSpanProcessor(traceExporter, {
                    scheduledDelayMillis: resolved.traceExportIntervalMs,
                    maxQueueSize: resolved.traceMaxQueueSize,
                    maxExportBatchSize: resolved.traceMaxExportBatchSize,
                    exportTimeoutMillis: resolved.exportTimeoutMs,
                }),
            ],
        });
        traceProvider.register();
        trace.setGlobalTracerProvider(traceProvider);
        const metricExporter = wrapWithRetry(new OTLPMetricExporter({
            url: `${endpoint}/v1/metrics`,
            headers,
            timeoutMillis: resolved.exportTimeoutMs,
        }), resolved.exportRetry, offline.hooks.metrics);
        const meterProvider = new MeterProvider({
            resource,
            readers: [
                new PeriodicExportingMetricReader({
                    exporter: metricExporter,
                    exportIntervalMillis: resolved.metricExportIntervalMs,
                    exportTimeoutMillis: Math.min(resolved.exportTimeoutMs, resolved.metricExportIntervalMs),
                }),
            ],
        });
        metrics.setGlobalMeterProvider(meterProvider);
        const logExporter = wrapWithRetry(new OTLPLogExporter({
            url: `${endpoint}/v1/logs`,
            headers,
            timeoutMillis: resolved.exportTimeoutMs,
        }), resolved.exportRetry, offline.hooks.logs);
        const loggerProvider = new LoggerProvider({
            resource,
            processors: [
                new BatchLogRecordProcessor(logExporter, {
                    scheduledDelayMillis: resolved.logExportScheduledDelayMs,
                    maxQueueSize: resolved.logMaxQueueSize,
                    maxExportBatchSize: resolved.logMaxExportBatchSize,
                    exportTimeoutMillis: resolved.exportTimeoutMs,
                }),
            ],
        });
        logs.setGlobalLoggerProvider(loggerProvider);
        const core = new ScoutCore(config, platform);
        await core.bootstrap();
        _instance = core;
        void offline.drainAll(headers);
        if (typeof document !== 'undefined') {
            const onVisible = () => {
                if (document.visibilityState === 'visible')
                    void offline.drainAll(headers);
            };
            document.addEventListener('visibilitychange', onVisible);
            _disposers.push(() => document.removeEventListener('visibilitychange', onVisible));
        }
        if (typeof window !== 'undefined') {
            const onOnline = () => void offline.drainAll(headers);
            window.addEventListener('online', onOnline);
            _disposers.push(() => window.removeEventListener('online', onOnline));
        }
        if (resolved.enableErrorTracking)
            _disposers.push(installErrorTracker(core));
        if (resolved.enableLifecycleTracking)
            _disposers.push(installLifecycleTracker(core, () => Scout.flush()));
        if (resolved.enableStartupTracking)
            _disposers.push(installStartupTracker(core));
        if (resolved.enableAutoTapTracking) {
            _disposers.push(installTapTracker(core));
            _disposers.push(installFrustrationTracker(core));
        }
        if (resolved.enableLongTaskDetection) {
            _disposers.push(installLongTaskTracker(core, resolved.longTaskThresholdMs));
        }
        if (resolved.enableMemoryMetrics)
            _disposers.push(installMemoryTracker(core));
        if (resolved.enableFrameMetrics)
            _disposers.push(installFrameMetricsTracker(core));
        if (resolved.enableWebVitals)
            _disposers.push(installWebVitalsTracker(core));
        if (resolved.enableBatteryTracking)
            _disposers.push(installBatteryTracker(core));
        if (resolved.enableAnrDetection)
            _disposers.push(installAnrDetector(core, resolved.anrThresholdMs));
        if (resolved.enableNetworkTracking) {
            _disposers.push(startPerformanceBuffer());
            _disposers.push(installNetworkTracker(core));
        }
        if (resolved.captureConsole)
            _disposers.push(installConsoleCapture(core));
        _disposers.push(installRouteTracker(core));
        _disposers.push(installCrashDetector(core));
        _disposers.push(installScrollDepthTracker(core));
        _disposers.push(installPageStateTracker(core));
        if (resolved.enableErrorTracking)
            _disposers.push(installCspViolationTracker(core));
        try {
            emitScoutConfigLog(core);
        }
        catch {
        }
        (Scout as any)._providers = { traceProvider, meterProvider, loggerProvider };
    },
    get isInitialized(): boolean {
        return _instance !== null;
    },
    get sessionId(): string | null {
        return _instance?.sessionId ?? null;
    },
    get userId(): string | null {
        return _instance?.userId ?? null;
    },
    get tracer() {
        return _instance?.otelTracer;
    },
    get instance(): ScoutCore | null {
        return _instance;
    },
    logEvent(name: string, attributes?: Attributes): void {
        if (_instance)
            emitScoutUsageOnce(_instance, 'logEvent');
        _instance?.logEvent(name, attributes);
    },
    addBreadcrumb(type: string, message: string): void {
        _instance?.addBreadcrumb(type, message);
    },
    reportError(error: unknown, opts?: {
        handled?: boolean;
        library?: string;
    }): void {
        if (_instance)
            emitScoutUsageOnce(_instance, 'reportError');
        _instance?.reportError(error, opts);
    },
    setUser(id: string, attributes?: Attributes): void {
        if (_instance)
            emitScoutUsageOnce(_instance, 'setUser');
        _instance?.setUser(id, attributes);
    },
    clearUser(): void {
        _instance?.clearUser();
    },
    setAccount(id: string, name?: string): void {
        if (_instance)
            emitScoutUsageOnce(_instance, 'setAccount');
        _instance?.setAccount(id, name);
    },
    clearAccount(): void {
        _instance?.clearAccount();
    },
    setFeatureFlag(name: string, value: AttributeValue): void {
        if (_instance)
            emitScoutUsageOnce(_instance, 'setFeatureFlag');
        _instance?.setFeatureFlag(name, value);
    },
    clearFeatureFlags(): void {
        _instance?.clearFeatureFlags();
    },
    addTiming(name: string): void {
        if (_instance)
            emitScoutUsageOnce(_instance, 'addTiming');
        _instance?.addTiming(name);
    },
    startVital(name: string, description?: string): void {
        if (_instance)
            emitScoutUsageOnce(_instance, 'startVital');
        _instance?.startVital(name, description);
    },
    endVital(name: string): void {
        if (_instance)
            emitScoutUsageOnce(_instance, 'endVital');
        _instance?.endVital(name);
    },
    recordOperationStep(name: string, stepType: 'start' | 'update' | 'retry' | 'end', opts?: {
        key?: string;
        failureReason?: 'error' | 'abandoned' | 'other';
    }): void {
        if (_instance)
            emitScoutUsageOnce(_instance, 'recordOperationStep');
        _instance?.recordOperationStep(name, stepType, opts);
    },
    logDebug(message: string, attributes?: Attributes): void {
        _instance?.logDebug(message, attributes);
    },
    logInfo(message: string, attributes?: Attributes): void {
        _instance?.logInfo(message, attributes);
    },
    logWarning(message: string, attributes?: Attributes): void {
        _instance?.logWarning(message, attributes);
    },
    logError(message: string, attributes?: Attributes): void {
        _instance?.logError(message, attributes);
    },
    async flush(): Promise<void> {
        const p = (Scout as any)._providers;
        if (!p)
            return;
        await Promise.allSettled([
            p.traceProvider.forceFlush(),
            p.meterProvider.forceFlush(),
            p.loggerProvider.forceFlush(),
        ]);
    },
    async shutdown(): Promise<void> {
        for (const d of _disposers.splice(0))
            d();
        const p = (Scout as any)._providers;
        if (p) {
            await Promise.allSettled([
                p.traceProvider.shutdown(),
                p.meterProvider.shutdown(),
                p.loggerProvider.shutdown(),
            ]);
        }
        await _instance?.shutdown();
        _instance = null;
    },
};
export default Scout;
