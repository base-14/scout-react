import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import {
  createOtlpTraceExporter,
  createOtlpMetricExporter,
  createOtlpLogExporter,
} from '../core/otlp-exporter';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { trace, metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { Scout as ScoutCore } from '../core/scout';
import {
  resolveConfig,
  resolveEndpoint,
  type ScoutConfig,
  type ResolvedConfig,
} from '../core/config';
import type { BreadcrumbManager } from '../core/breadcrumb-manager';
import { wrapWithRetry } from '../core/retry-exporter';
import { buildOfflineWiring } from '../core/offline-wiring';
import type { Attributes, AttributeValue } from '../core/types';
import { ATTR } from '../core/attributes';
import { SCOPE_VERSION } from '../core/scope';
import { SPAN, BREADCRUMB_TYPE } from '../core/spans';
import { NativePlatform } from './platform';
import { installNativeRejectionTracker } from './instrumentations/error';
import { installNativeLifecycleTracker } from './instrumentations/lifecycle';
import { installNativeNetworkTracker } from './instrumentations/network';
import { installNativeNavigationTracker } from './instrumentations/navigation';
import { installNativeCrashDetector } from './instrumentations/crash';
import { installNativeAnrDetector } from './instrumentations/anr';
import { installNativeMemoryTracker } from './instrumentations/memory';
import { installNativeCpuTracker } from './instrumentations/cpu';
import { installOrientationTracker } from './instrumentations/orientation';
import { installBatteryDischargeTracker } from './instrumentations/battery-discharge';
import { installNativeFrameMetricsTracker } from './instrumentations/frame-metrics';
import { installNativeConsoleCapture } from './instrumentations/console';
import { installNativeScrollTracker } from './instrumentations/scroll';
import { installNativeTapTracker } from './instrumentations/tap';
import { installNativeCrashReader } from './instrumentations/native-crash';
import { installUiHangDetector } from './instrumentations/ui-hang';
import { installNativeContextTracker } from './instrumentations/context';
import { emitScoutConfigLog, emitScoutUsageOnce } from '../core/telemetry';
import { ScoutRootBoundary } from './error-boundary';
import { withSuppression, isSuppressingSdkErrors } from './soft-load';
export { ATTR } from '../core/attributes';
export { SPAN, BREADCRUMB_TYPE } from '../core/spans';
export { METRIC } from '../core/metrics';
export { ScoutCore };
export { ScoutTouchBoundary } from './touch-boundary';
export { useScoutScrollTracking } from './scroll-observer';
export { ScoutErrorBoundary, ScoutRootBoundary } from './error-boundary';
export type {
  Attributes,
  AttributeValue,
  BeforeSendCallback,
  BeforeSendEvent,
  Breadcrumb,
  SeverityText,
} from '../core/types';
export type { ScoutConfig } from '../core/config';
let _instance: ScoutCore | null = null;
const _disposers: Array<() => void> = [];
const _pendingNavigationRefs: any[] = [];
interface BufferedError {
  error: unknown;
  isFatal: boolean;
}

async function readNativeProcessStartMs(): Promise<number | null> {
  try {
    const ExpoModules = withSuppression(() => require('expo-modules-core'));
    const mod = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash');
    if (typeof mod?.getProcessStartTimeMillis !== 'function') return null;
    const v = await mod.getProcessStartTimeMillis();
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
export const Scout = {
  async initialize(config: ScoutConfig): Promise<void> {
    if (_instance) return;
    const g: any = globalThis as any;
    const ErrorUtils = g.ErrorUtils;
    const originalHandler = ErrorUtils?.getGlobalHandler?.();
    const earlyBuffer: BufferedError[] = [];
    let installedEarlyHandler = false;
    const wantsErrorTracking = config.enableErrorTracking !== false;
    if (ErrorUtils?.setGlobalHandler && wantsErrorTracking) {
      ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        if (isSuppressingSdkErrors()) {
          if (originalHandler) originalHandler(error, isFatal);
          return;
        }
        try {
          if (_instance) {
            if (isFatal) _instance.reportUncaught(error);
            else _instance.reportError(error, { handled: false });
          } else {
            earlyBuffer.push({ error, isFatal: !!isFatal });
          }
        } catch {}
        if (originalHandler) originalHandler(error, isFatal);
      });
      installedEarlyHandler = true;
    }
    const resolved = resolveConfig(config);
    const endpoint = resolveEndpoint(resolved.endpoint, resolved.secure);
    const platform = new NativePlatform();
    const offline = buildOfflineWiring(platform, endpoint, resolved.offlineBuffer);
    const meta = platform.readAppMetadata
      ? await platform.readAppMetadata()
      : { version: null, build: null, bundleId: null };
    if (config.serviceVersion === undefined && meta.version) {
      resolved.serviceVersion = meta.build
        ? `${meta.version}+${meta.build}`
        : meta.version;
    }
    const baseAttrs = await platform.collectResourceAttributes();
    const appAttrs: Record<string, string> = {};
    if (meta.version) appAttrs[ATTR.APP_VERSION] = meta.version;
    if (meta.build) appAttrs[ATTR.APP_BUILD] = meta.build;
    if (meta.bundleId) appAttrs[ATTR.APP_BUNDLE_ID] = meta.bundleId;
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: resolved.serviceName,
      [ATTR_SERVICE_VERSION]: resolved.serviceVersion,
      ...(resolved.environment ? { environment: resolved.environment } : {}),
      ...(resolved.applicationId
        ? { [ATTR.APPLICATION_ID]: resolved.applicationId }
        : {}),
      ...(resolved.buildId ? { [ATTR.APP_BUILD_ID]: resolved.buildId } : {}),
      ...appAttrs,
      ...baseAttrs,
      ...((resolved.resourceAttributes as Record<string, any>) ?? {}),
      // Last: the SDK's own version must not be shadowable by integrator
      // resource attributes — the backend uses it to attribute every signal.
      [ATTR.SCOUT_REACT_VERSION]: SCOPE_VERSION,
    });
    const headers = resolved.headers ?? {};
    const traceExporter = wrapWithRetry(
      createOtlpTraceExporter({
        url: `${endpoint}/v1/traces`,
        headers,
        timeoutMillis: resolved.exportTimeoutMs,
      }),
      resolved.exportRetry,
      { ...offline.hooks.traces, debug: !!resolved.debug, label: 'traces' },
    );
    const traceProvider = new BasicTracerProvider({
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
    trace.setGlobalTracerProvider(traceProvider);
    const metricExporter = wrapWithRetry(
      createOtlpMetricExporter({
        url: `${endpoint}/v1/metrics`,
        headers,
        timeoutMillis: resolved.exportTimeoutMs,
      }),
      resolved.exportRetry,
      { ...offline.hooks.metrics, debug: !!resolved.debug, label: 'metrics' },
    );
    const meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: resolved.metricExportIntervalMs,
          exportTimeoutMillis: Math.min(
            resolved.exportTimeoutMs,
            resolved.metricExportIntervalMs,
          ),
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);
    const logExporter = wrapWithRetry(
      createOtlpLogExporter({
        url: `${endpoint}/v1/logs`,
        headers,
        timeoutMillis: resolved.exportTimeoutMs,
      }),
      resolved.exportRetry,
      { ...offline.hooks.logs, debug: !!resolved.debug, label: 'logs' },
    );
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
    (Scout as any)._providers = { traceProvider, meterProvider, loggerProvider };
    const core = new ScoutCore(config, platform);
    await core.bootstrap();
    _instance = core;
    void offline.drainAll(headers);
    if (resolved.enableLifecycleTracking) {
      let lastState: string | undefined;
      try {
        const RN = require('react-native');
        const sub = RN?.AppState?.addEventListener?.('change', (state: string) => {
          if (lastState !== 'active' && state === 'active') {
            void offline.drainAll(headers);
          }
          lastState = state;
        });
        if (sub?.remove) _disposers.push(() => sub.remove());
      } catch {}
    }
    while (_pendingNavigationRefs.length > 0) {
      const navRef = _pendingNavigationRefs.shift();
      try {
        const dispose = installNativeNavigationTracker(core, navRef);
        _disposers.push(dispose);
      } catch {}
    }
    while (earlyBuffer.length > 0) {
      const item = earlyBuffer.shift()!;
      try {
        if (item.isFatal) core.reportUncaught(item.error);
        else core.reportError(item.error, { handled: false });
      } catch {}
    }
    if (resolved.enableErrorTracking)
      _disposers.push(installNativeRejectionTracker(core));
    if (resolved.enableLifecycleTracking)
      _disposers.push(installNativeLifecycleTracker(core, () => Scout.flush()));
    if (resolved.enableNetworkTracking)
      _disposers.push(installNativeNetworkTracker(core));
    if (resolved.enableAnrDetection)
      _disposers.push(await installNativeAnrDetector(core, resolved.anrThresholdMs));
    const vitalsIntervalMs = resolved.vitalsCollectionIntervalSeconds * 1000;
    if (resolved.enableMemoryMetrics)
      _disposers.push(installNativeMemoryTracker(core, vitalsIntervalMs));
    if (resolved.enableCpuMetrics)
      _disposers.push(installNativeCpuTracker(core, vitalsIntervalMs));
    _disposers.push(installOrientationTracker(core));
    if (resolved.enableBatteryTracking)
      _disposers.push(installBatteryDischargeTracker(core, vitalsIntervalMs));
    if (resolved.enableFrameMetrics)
      _disposers.push(
        installNativeFrameMetricsTracker(
          core,
          resolved.longTaskThresholdMs,
          vitalsIntervalMs,
        ),
      );
    if (resolved.captureConsole) _disposers.push(installNativeConsoleCapture(core));
    _disposers.push(installNativeTapTracker(core));
    _disposers.push(installNativeScrollTracker(core));
    _disposers.push(installNativeContextTracker(core));
    _disposers.push(await installNativeCrashDetector(core));
    void installNativeCrashReader(core);
    _disposers.push(await installUiHangDetector(core, resolved.iosHangThresholdMs));
    try {
      const ExpoModules = withSuppression(() => require('expo-modules-core'));
      const ScoutCrash: any = ExpoModules?.requireOptionalNativeModule?.('ScoutCrash');
      if (typeof ScoutCrash?.setBreadcrumbs === 'function') {
        core.breadcrumbsManager.setNativeSink((json) => {
          try {
            void ScoutCrash.setBreadcrumbs(json);
          } catch {}
        });
      }
      if (typeof ScoutCrash?.setMaxTombstoneBytes === 'function') {
        try {
          void ScoutCrash.setMaxTombstoneBytes(resolved.maxTombstoneBytes);
        } catch {}
      }
      const pushSessionContext = () => {
        if (typeof ScoutCrash?.setSessionContext !== 'function') return;
        const sid = core.sessionId;
        const sstart = core.sessionManager.startedAtIso;
        if (!sid || !sstart) return;
        try {
          void ScoutCrash.setSessionContext(sid, sstart);
        } catch {}
      };
      pushSessionContext();
      if (typeof ScoutCrash?.notifySessionRotated === 'function') {
        core.sessionManager.setRotationListener(() => {
          try {
            void ScoutCrash.notifySessionRotated();
          } catch {}
          pushSessionContext();
        });
      } else if (typeof ScoutCrash?.setSessionContext === 'function') {
        core.sessionManager.setRotationListener(() => {
          pushSessionContext();
        });
      }
    } catch {}
    const nativeStartMs = await readNativeProcessStartMs();
    const coldDurationSec =
      nativeStartMs !== null
        ? (Date.now() - nativeStartMs) / 1000
        : core.timeSinceAppStartMs() / 1000;
    core.emitSpan(SPAN.APP_STARTUP, {
      [ATTR.APP_STARTUP_TYPE]: 'cold',
      [ATTR.APP_STARTUP_DURATION]: coldDurationSec,
      ...core.commonAttributes(),
    });
    const fbcMs = Math.round(coldDurationSec * 1000);
    core.emitSpan(SPAN.APP_VITAL, {
      [ATTR.VITAL_NAME]: 'fbc',
      [ATTR.VITAL_TYPE]: 'startup',
      [ATTR.VITAL_DURATION]: coldDurationSec,
      [ATTR.VITAL_DURATION_MS]: fbcMs,
      ...core.commonAttributes(),
    });
    core.addBreadcrumb(BREADCRUMB_TYPE.STARTUP, `cold_start: ${fbcMs}ms`);
    try {
      emitScoutConfigLog(core);
    } catch {}
    if (installedEarlyHandler) {
      _disposers.push(() => {
        try {
          ErrorUtils?.setGlobalHandler?.(originalHandler);
        } catch {}
      });
    }
  },
  attachNavigationContainer(navigationRef: any): () => void {
    if (!_instance) {
      _pendingNavigationRefs.push(navigationRef);
      return () => {
        const idx = _pendingNavigationRefs.indexOf(navigationRef);
        if (idx >= 0) _pendingNavigationRefs.splice(idx, 1);
      };
    }
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
      } catch {}
    }
    const expoRegister = withSuppression(() => {
      try {
        return require('expo').registerRootComponent;
      } catch {
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
  get config(): ResolvedConfig | null {
    return _instance?.config ?? null;
  },
  get userAttributes(): Readonly<Attributes> {
    return _instance?.userAttributes ?? {};
  },
  get anonymousId(): string | null {
    return _instance?.anonymousId ?? null;
  },
  get breadcrumbsManager(): BreadcrumbManager | null {
    return _instance?.breadcrumbsManager ?? null;
  },
  logEvent(name: string, attributes?: Attributes): void {
    if (_instance) emitScoutUsageOnce(_instance, 'logEvent');
    _instance?.logEvent(name, attributes);
  },
  addBreadcrumb(type: string, message: string): void {
    _instance?.addBreadcrumb(type, message);
  },
  reportError(
    error: unknown,
    opts?: {
      handled?: boolean;
      library?: string;
    },
  ): void {
    if (_instance) emitScoutUsageOnce(_instance, 'reportError');
    _instance?.reportError(error, opts);
  },
  setUser(id: string, attributes?: Attributes): void {
    if (_instance) emitScoutUsageOnce(_instance, 'setUser');
    _instance?.setUser(id, attributes);
  },
  clearUser(): void {
    _instance?.clearUser();
  },
  setSessionAttributes(attrs: Attributes): void {
    _instance?.setSessionAttributes(attrs);
  },
  clearSessionAttributes(): void {
    _instance?.clearSessionAttributes();
  },
  setAccount(id: string, name?: string): void {
    if (_instance) emitScoutUsageOnce(_instance, 'setAccount');
    _instance?.setAccount(id, name);
  },
  clearAccount(): void {
    _instance?.clearAccount();
  },
  setFeatureFlag(name: string, value: AttributeValue): void {
    if (_instance) emitScoutUsageOnce(_instance, 'setFeatureFlag');
    _instance?.setFeatureFlag(name, value);
  },
  clearFeatureFlags(): void {
    _instance?.clearFeatureFlags();
  },
  addTiming(name: string): void {
    if (_instance) emitScoutUsageOnce(_instance, 'addTiming');
    _instance?.addTiming(name);
  },
  startVital(name: string, description?: string): void {
    if (_instance) emitScoutUsageOnce(_instance, 'startVital');
    _instance?.startVital(name, description);
  },
  endVital(name: string): void {
    if (_instance) emitScoutUsageOnce(_instance, 'endVital');
    _instance?.endVital(name);
  },
  recordOperationStep(
    name: string,
    stepType: 'start' | 'update' | 'retry' | 'end',
    opts?: {
      key?: string;
      failureReason?: 'error' | 'abandoned' | 'other';
    },
  ): void {
    if (_instance) emitScoutUsageOnce(_instance, 'recordOperationStep');
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
    if (!p) return;
    await Promise.allSettled([
      p.traceProvider.forceFlush(),
      p.meterProvider.forceFlush(),
      p.loggerProvider.forceFlush(),
    ]);
  },
  async shutdown(): Promise<void> {
    for (const d of _disposers.splice(0)) d();
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
