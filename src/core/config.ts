import type { Attributes, BeforeSendCallback } from './types';
export interface CustomTargetInfo {
  elementName: string;
  searchForBetter?: boolean;
  searchForText?: boolean;
}
export type CustomTargetResolver = (node: unknown) => CustomTargetInfo | null;
/**
 * DOM events auto-tap tracking can emit `user_interaction` spans for. The value
 * lands on the span as `user_interaction.type`, so it is also the vocabulary
 * dashboards filter on.
 */
export type InteractionEvent = 'click' | 'change' | 'submit' | 'input';
export const DEFAULT_INTERACTION_EVENTS: InteractionEvent[] = [
  'click',
  'change',
  'submit',
  'input',
];
export interface ScoutConfig {
  serviceName: string;
  endpoint: string;
  serviceVersion?: string;
  environment?: string;
  applicationId?: string;
  buildId?: string;
  secure?: boolean;
  headers?: Record<string, string>;
  resourceAttributes?: Attributes;
  enableAutoTapTracking?: boolean;
  /**
   * Which DOM events auto-tap tracking listens to. Web only; ignored when
   * `enableAutoTapTracking` is false. Narrow this on chatty UIs — `input` is
   * the usual first thing to drop.
   */
  interactionEvents?: InteractionEvent[];
  enableErrorTracking?: boolean;
  enableLifecycleTracking?: boolean;
  enableStartupTracking?: boolean;
  enableConnectivityTracking?: boolean;
  enablePerformanceMetrics?: boolean;
  enableLongTaskDetection?: boolean;
  enableAnrDetection?: boolean;
  enableFrameMetrics?: boolean;
  enableMemoryMetrics?: boolean;
  enableCpuMetrics?: boolean;
  enableWebVitals?: boolean;
  maxTombstoneBytes?: number;
  enableBatteryTracking?: boolean;
  enableNetworkTracking?: boolean;
  enableLogging?: boolean;
  captureConsole?: boolean;
  capturePrintStatements?: boolean;
  longTaskThresholdMs?: number;
  anrThresholdMs?: number;
  iosHangThresholdMs?: number;
  sessionSampleRate?: number;
  sessionTimeoutMinutes?: number;
  maxSessionDurationMinutes?: number;
  alwaysCaptureErrors?: boolean;
  firstPartyHosts?: Array<string | RegExp>;
  ignoreUrlPatterns?: RegExp[];
  maxOfflineStorageMb?: number;
  beforeSend?: BeforeSendCallback;
  customTargetResolver?: CustomTargetResolver;
  /**
   * Export cadence for traces, logs AND metrics (default 30, min 1).
   * The per-signal `*Ms` options below override it when explicitly set.
   */
  exportIntervalSeconds?: number;
  /** Metrics-only override; falls back to `exportIntervalSeconds`. */
  metricExportIntervalSeconds?: number;
  /** Applied to the trace + log batch processors (default 512). */
  maxExportBatchSize?: number;
  /** Applied to the trace + log batch processors (default 2048). */
  maxQueueSize?: number;
  /**
   * Sampling cadence for memory / CPU / frame / battery vitals
   * (default 60, min 1). Only in effect when those vitals are enabled.
   */
  vitalsCollectionIntervalSeconds?: number;
  traceExportIntervalMs?: number;
  traceMaxQueueSize?: number;
  traceMaxExportBatchSize?: number;
  metricExportIntervalMs?: number;
  logExportScheduledDelayMs?: number;
  logMaxQueueSize?: number;
  logMaxExportBatchSize?: number;
  exportTimeoutMs?: number;
  exportRetry?: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
  offlineBuffer?: {
    enabled?: boolean;
    maxItems?: {
      traces?: number;
      metrics?: number;
      logs?: number;
    };
  };
  debug?: boolean;
}
export interface ResolvedRetry {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}
export interface ResolvedOfflineBuffer {
  enabled: boolean;
  maxItems: {
    traces: number;
    metrics: number;
    logs: number;
  };
}
export interface ResolvedConfig extends Required<
  Omit<
    ScoutConfig,
    | 'environment'
    | 'headers'
    | 'resourceAttributes'
    | 'firstPartyHosts'
    | 'ignoreUrlPatterns'
    | 'beforeSend'
    | 'customTargetResolver'
    | 'applicationId'
    | 'buildId'
    | 'exportRetry'
    | 'offlineBuffer'
  >
> {
  environment?: string;
  headers?: Record<string, string>;
  resourceAttributes?: Attributes;
  firstPartyHosts?: Array<string | RegExp>;
  ignoreUrlPatterns?: RegExp[];
  beforeSend?: BeforeSendCallback;
  customTargetResolver?: CustomTargetResolver;
  applicationId?: string;
  buildId?: string;
  exportRetry: ResolvedRetry;
  offlineBuffer: ResolvedOfflineBuffer;
}
export function resolveConfig(config: ScoutConfig): ResolvedConfig {
  const longTaskThresholdMs = Math.max(20, config.longTaskThresholdMs ?? 100);
  const anrThresholdMs = Math.max(1000, config.anrThresholdMs ?? 5000);
  const iosHangRaw = config.iosHangThresholdMs ?? 250;
  const iosHangThresholdMs = iosHangRaw <= 0 ? 0 : Math.max(50, iosHangRaw);
  const sessionSampleRate = clamp(config.sessionSampleRate ?? 1, 0, 100);
  const captureConsole = config.captureConsole ?? config.capturePrintStatements ?? false;
  const exportIntervalSeconds = Math.max(1, config.exportIntervalSeconds ?? 30);
  const exportIntervalMs = exportIntervalSeconds * 1000;
  const metricIntervalMs =
    config.metricExportIntervalSeconds != null
      ? Math.max(1, config.metricExportIntervalSeconds) * 1000
      : exportIntervalMs;
  const maxExportBatchSize = Math.max(1, config.maxExportBatchSize ?? 512);
  const maxQueueSize = Math.max(1, config.maxQueueSize ?? 2048);
  const vitalsCollectionIntervalSeconds = Math.max(
    1,
    config.vitalsCollectionIntervalSeconds ?? 60,
  );
  return {
    serviceName: config.serviceName,
    endpoint: config.endpoint,
    serviceVersion: config.serviceVersion ?? '1.0.0',
    environment: config.environment,
    applicationId: config.applicationId,
    buildId: config.buildId,
    secure: config.secure ?? true,
    headers: config.headers,
    resourceAttributes: config.resourceAttributes,
    enableAutoTapTracking: config.enableAutoTapTracking ?? true,
    interactionEvents: config.interactionEvents ?? DEFAULT_INTERACTION_EVENTS,
    enableErrorTracking: config.enableErrorTracking ?? true,
    enableLifecycleTracking: config.enableLifecycleTracking ?? true,
    enableStartupTracking: config.enableStartupTracking ?? true,
    enableConnectivityTracking: config.enableConnectivityTracking ?? true,
    enablePerformanceMetrics: config.enablePerformanceMetrics ?? true,
    enableLongTaskDetection: config.enableLongTaskDetection ?? true,
    enableAnrDetection: config.enableAnrDetection ?? true,
    // Opt-in: these are the highest-volume metrics the SDK can produce, and
    // at the inherited sampling rate they dwarf every other signal.
    enableFrameMetrics: config.enableFrameMetrics ?? false,
    enableMemoryMetrics: config.enableMemoryMetrics ?? false,
    enableCpuMetrics: config.enableCpuMetrics ?? false,
    maxTombstoneBytes: Math.max(4096, config.maxTombstoneBytes ?? 131072),
    enableWebVitals: config.enableWebVitals ?? true,
    enableBatteryTracking: config.enableBatteryTracking ?? true,
    enableNetworkTracking: config.enableNetworkTracking ?? true,
    enableLogging: config.enableLogging ?? true,
    captureConsole,
    capturePrintStatements: captureConsole,
    longTaskThresholdMs,
    anrThresholdMs,
    iosHangThresholdMs,
    sessionSampleRate,
    sessionTimeoutMinutes: config.sessionTimeoutMinutes ?? 30,
    maxSessionDurationMinutes: Math.max(0, config.maxSessionDurationMinutes ?? 60),
    alwaysCaptureErrors: config.alwaysCaptureErrors ?? true,
    firstPartyHosts: config.firstPartyHosts,
    ignoreUrlPatterns: config.ignoreUrlPatterns,
    maxOfflineStorageMb: config.maxOfflineStorageMb ?? 5,
    beforeSend: config.beforeSend,
    customTargetResolver: config.customTargetResolver,
    exportIntervalSeconds,
    // Resolved to the *effective* metric cadence — inherited from
    // exportIntervalSeconds unless explicitly overridden.
    metricExportIntervalSeconds: metricIntervalMs / 1000,
    maxExportBatchSize,
    maxQueueSize,
    vitalsCollectionIntervalSeconds,
    traceExportIntervalMs: config.traceExportIntervalMs ?? exportIntervalMs,
    traceMaxQueueSize: config.traceMaxQueueSize ?? maxQueueSize,
    traceMaxExportBatchSize: config.traceMaxExportBatchSize ?? maxExportBatchSize,
    metricExportIntervalMs: config.metricExportIntervalMs ?? metricIntervalMs,
    logExportScheduledDelayMs: config.logExportScheduledDelayMs ?? exportIntervalMs,
    logMaxQueueSize: config.logMaxQueueSize ?? maxQueueSize,
    logMaxExportBatchSize: config.logMaxExportBatchSize ?? maxExportBatchSize,
    exportTimeoutMs: config.exportTimeoutMs ?? 30000,
    // At-most-once by default: retrying an ambiguous failure (a timeout the
    // collector may already have ingested) re-delivers identical span IDs.
    exportRetry: {
      maxRetries: Math.max(0, config.exportRetry?.maxRetries ?? 0),
      initialDelayMs: Math.max(100, config.exportRetry?.initialDelayMs ?? 1000),
      maxDelayMs: Math.max(1000, config.exportRetry?.maxDelayMs ?? 30000),
    },
    offlineBuffer: {
      enabled: config.offlineBuffer?.enabled ?? false,
      maxItems: {
        traces: Math.max(0, config.offlineBuffer?.maxItems?.traces ?? 0),
        metrics: Math.max(0, config.offlineBuffer?.maxItems?.metrics ?? 0),
        logs: Math.max(0, config.offlineBuffer?.maxItems?.logs ?? 0),
      },
    },
    debug: config.debug ?? false,
  };
}
export function resolveEndpoint(endpoint: string, secure: boolean): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  return `${secure ? 'https' : 'http'}://${endpoint}`;
}
function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
