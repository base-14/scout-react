import type { Attributes, BeforeSendCallback } from './types';
export interface ScoutConfig {
    serviceName: string;
    endpoint: string;
    serviceVersion?: string;
    environment?: string;
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
    enableWebVitals?: boolean;
    enableBatteryTracking?: boolean;
    enableNetworkTracking?: boolean;
    enableLogging?: boolean;
    captureConsole?: boolean;
    capturePrintStatements?: boolean;
    longTaskThresholdMs?: number;
    anrThresholdMs?: number;
    sessionSampleRate?: number;
    sessionTimeoutMinutes?: number;
    firstPartyHosts?: Array<string | RegExp>;
    ignoreUrlPatterns?: RegExp[];
    maxOfflineStorageMb?: number;
    beforeSend?: BeforeSendCallback;
    metricExportIntervalMs?: number;
    logExportScheduledDelayMs?: number;
    debug?: boolean;
}
export interface ResolvedConfig extends Required<Omit<ScoutConfig, 'environment' | 'headers' | 'resourceAttributes' | 'firstPartyHosts' | 'ignoreUrlPatterns' | 'beforeSend'>> {
    environment?: string;
    headers?: Record<string, string>;
    resourceAttributes?: Attributes;
    firstPartyHosts?: Array<string | RegExp>;
    ignoreUrlPatterns?: RegExp[];
    beforeSend?: BeforeSendCallback;
}
export function resolveConfig(config: ScoutConfig): ResolvedConfig {
    const longTaskThresholdMs = Math.max(20, config.longTaskThresholdMs ?? 100);
    const anrThresholdMs = Math.max(1000, config.anrThresholdMs ?? 5000);
    const sessionSampleRate = clamp(config.sessionSampleRate ?? 100, 0, 100);
    const captureConsole = config.captureConsole ?? config.capturePrintStatements ?? false;
    return {
        serviceName: config.serviceName,
        endpoint: config.endpoint,
        serviceVersion: config.serviceVersion ?? '1.0.0',
        environment: config.environment,
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
        enableWebVitals: config.enableWebVitals ?? true,
        enableBatteryTracking: config.enableBatteryTracking ?? true,
        enableNetworkTracking: config.enableNetworkTracking ?? true,
        enableLogging: config.enableLogging ?? true,
        captureConsole,
        capturePrintStatements: captureConsole,
        longTaskThresholdMs,
        anrThresholdMs,
        sessionSampleRate,
        sessionTimeoutMinutes: config.sessionTimeoutMinutes ?? 30,
        firstPartyHosts: config.firstPartyHosts,
        ignoreUrlPatterns: config.ignoreUrlPatterns,
        maxOfflineStorageMb: config.maxOfflineStorageMb ?? 5,
        beforeSend: config.beforeSend,
        metricExportIntervalMs: config.metricExportIntervalMs ?? 30000,
        logExportScheduledDelayMs: config.logExportScheduledDelayMs ?? 5000,
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
