import type { Attributes, BeforeSendCallback } from './types';
export interface CustomTargetInfo {
  elementName: string;
  searchForBetter?: boolean;
  searchForText?: boolean;
}
export type CustomTargetResolver = (node: unknown) => CustomTargetInfo | null;
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
    enableErrorTracking: config.enableErrorTracking ?? true,
    enableLifecycleTracking: config.enableLifecycleTracking ?? true,
    enableStartupTracking: config.enableStartupTracking ?? true,
    enableConnectivityTracking: config.enableConnectivityTracking ?? true,
    enablePerformanceMetrics: config.enablePerformanceMetrics ?? true,
    enableLongTaskDetection: config.enableLongTaskDetection ?? true,
    enableAnrDetection: config.enableAnrDetection ?? true,
    enableFrameMetrics: config.enableFrameMetrics ?? true,
    enableMemoryMetrics: config.enableMemoryMetrics ?? true,
    enableCpuMetrics: config.enableCpuMetrics ?? true,
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
    traceExportIntervalMs: config.traceExportIntervalMs ?? 5000,
    traceMaxQueueSize: config.traceMaxQueueSize ?? 2048,
    traceMaxExportBatchSize: config.traceMaxExportBatchSize ?? 512,
    metricExportIntervalMs: config.metricExportIntervalMs ?? 30000,
    logExportScheduledDelayMs: config.logExportScheduledDelayMs ?? 5000,
    logMaxQueueSize: config.logMaxQueueSize ?? 2048,
    logMaxExportBatchSize: config.logMaxExportBatchSize ?? 512,
    exportTimeoutMs: config.exportTimeoutMs ?? 30000,
    exportRetry: {
      maxRetries: Math.max(0, config.exportRetry?.maxRetries ?? 3),
      initialDelayMs: Math.max(100, config.exportRetry?.initialDelayMs ?? 1000),
      maxDelayMs: Math.max(1000, config.exportRetry?.maxDelayMs ?? 30000),
    },
    offlineBuffer: {
      enabled: config.offlineBuffer?.enabled ?? true,
      maxItems: {
        traces: Math.max(0, config.offlineBuffer?.maxItems?.traces ?? 5000),
        metrics: Math.max(0, config.offlineBuffer?.maxItems?.metrics ?? 2000),
        logs: Math.max(0, config.offlineBuffer?.maxItems?.logs ?? 5000),
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
