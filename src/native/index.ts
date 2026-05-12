import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
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
import type { Attributes } from '../core/types';
import { ATTR } from '../core/attributes';
import { SPAN } from '../core/spans';
import { NativePlatform } from './platform';
import { installNativeRejectionTracker } from './instrumentations/error';
import { installNativeLifecycleTracker } from './instrumentations/lifecycle';
import { installNativeNetworkTracker } from './instrumentations/network';
import { installNativeNavigationTracker } from './instrumentations/navigation';
import { installNativeCrashDetector } from './instrumentations/crash';
import { installNativeAnrDetector } from './instrumentations/anr';
import { ScoutRootBoundary } from './error-boundary';
import { withSuppression, isSuppressingSdkErrors } from './soft-load';
export { ATTR } from '../core/attributes';
export { SPAN, BREADCRUMB_TYPE } from '../core/spans';
export { METRIC } from '../core/metrics';
export { ScoutCore };
export { ScoutTouchBoundary } from './touch-boundary';
export { ScoutErrorBoundary, ScoutRootBoundary } from './error-boundary';
export type { Attributes, AttributeValue, BeforeSendCallback, BeforeSendEvent, Breadcrumb, SeverityText, } from '../core/types';
export type { ScoutConfig } from '../core/config';
let _instance: ScoutCore | null = null;
const _disposers: Array<() => void> = [];
interface BufferedError {
    error: unknown;
    isFatal: boolean;
}
export const Scout = {
    async initialize(config: ScoutConfig): Promise<void> {
        if (_instance)
            return;
        const g: any = globalThis as any;
        const ErrorUtils = g.ErrorUtils;
        const originalHandler = ErrorUtils?.getGlobalHandler?.();
        const earlyBuffer: BufferedError[] = [];
        let installedEarlyHandler = false;
        const wantsErrorTracking = config.enableErrorTracking !== false;
        if (ErrorUtils?.setGlobalHandler && wantsErrorTracking) {
            ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
                if (isSuppressingSdkErrors()) {
                    if (originalHandler)
                        originalHandler(error, isFatal);
                    return;
                }
                try {
                    if (_instance) {
                        if (isFatal)
                            _instance.reportUncaught(error);
                        else
                            _instance.reportError(error, { handled: false });
                    }
                    else {
                        earlyBuffer.push({ error, isFatal: !!isFatal });
                    }
                }
                catch {
                }
                if (originalHandler)
                    originalHandler(error, isFatal);
            });
            installedEarlyHandler = true;
        }
        const resolved = resolveConfig(config);
        const endpoint = resolveEndpoint(resolved.endpoint, resolved.secure);
        const platform = new NativePlatform();
        const baseAttrs = await platform.collectResourceAttributes();
        const resource = resourceFromAttributes({
            [ATTR_SERVICE_NAME]: resolved.serviceName,
            [ATTR_SERVICE_VERSION]: resolved.serviceVersion,
            ...(resolved.environment ? { environment: resolved.environment } : {}),
            ...baseAttrs,
            ...((resolved.resourceAttributes as Record<string, any>) ?? {}),
        });
        const headers = resolved.headers ?? {};
        const traceProvider = new BasicTracerProvider({
            resource,
            spanProcessors: [
                new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers })),
            ],
        });
        trace.setGlobalTracerProvider(traceProvider);
        const meterProvider = new MeterProvider({
            resource,
            readers: [
                new PeriodicExportingMetricReader({
                    exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers }),
                    exportIntervalMillis: resolved.metricExportIntervalMs,
                }),
            ],
        });
        metrics.setGlobalMeterProvider(meterProvider);
        const loggerProvider = new LoggerProvider({
            resource,
            processors: [
                new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint}/v1/logs`, headers }), { scheduledDelayMillis: resolved.logExportScheduledDelayMs }),
            ],
        });
        logs.setGlobalLoggerProvider(loggerProvider);
        const core = new ScoutCore(config, platform);
        await core.bootstrap();
        _instance = core;
        while (earlyBuffer.length > 0) {
            const item = earlyBuffer.shift()!;
            try {
                if (item.isFatal)
                    core.reportUncaught(item.error);
                else
                    core.reportError(item.error, { handled: false });
            }
            catch {
            }
        }
        if (resolved.enableErrorTracking)
            _disposers.push(installNativeRejectionTracker(core));
        if (resolved.enableLifecycleTracking)
            _disposers.push(installNativeLifecycleTracker(core));
        if (resolved.enableNetworkTracking)
            _disposers.push(installNativeNetworkTracker(core));
        if (resolved.enableAnrDetection)
            _disposers.push(installNativeAnrDetector(core, resolved.anrThresholdMs));
        _disposers.push(await installNativeCrashDetector(core));
        core.startRootSpan(SPAN.APP_STARTUP, {
            [ATTR.APP_STARTUP_TYPE]: 'session',
        });
        if (installedEarlyHandler) {
            _disposers.push(() => {
                try {
                    ErrorUtils?.setGlobalHandler?.(originalHandler);
                }
                catch {
                }
            });
        }
    },
    attachNavigationContainer(navigationRef: any): () => void {
        if (!_instance)
            return () => { };
        const dispose = installNativeNavigationTracker(_instance, navigationRef);
        _disposers.push(dispose);
        return dispose;
    },
    registerRootComponent(component: any): void {
        const RN = withSuppression(() => require('react-native'));
        const AppRegistry = RN?.AppRegistry;
        if (AppRegistry?.setWrapperComponentProvider) {
            try {
                AppRegistry.setWrapperComponentProvider(() => ScoutRootBoundary);
            }
            catch {
            }
        }
        const expoRegister = withSuppression(() => {
            try {
                return require('expo').registerRootComponent;
            }
            catch {
                return null;
            }
        });
        if (typeof expoRegister === 'function') {
            expoRegister(component);
            return;
        }
        AppRegistry?.registerComponent?.('main', () => component);
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
        _instance?.logEvent(name, attributes);
    },
    addBreadcrumb(type: string, message: string): void {
        _instance?.addBreadcrumb(type, message);
    },
    reportError(error: unknown, opts?: {
        handled?: boolean;
        library?: string;
    }): void {
        _instance?.reportError(error, opts);
    },
    setUser(id: string, attributes?: Attributes): void {
        _instance?.setUser(id, attributes);
    },
    clearUser(): void {
        _instance?.clearUser();
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
    async shutdown(): Promise<void> {
        for (const d of _disposers.splice(0))
            d();
        await _instance?.shutdown();
        _instance = null;
    },
};
export default Scout;
