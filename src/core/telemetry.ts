import type { Scout } from './scout';
import { SCOPE_NAME, SCOPE_VERSION } from './scope';
export function emitScoutConfigLog(scout: Scout): void {
  const cfg = scout.config as unknown as Record<string, unknown>;
  const attrs: Record<string, unknown> = {
    'scout.diag': true,
    'scout.config.scope_name': SCOPE_NAME,
    'scout.config.scope_version': SCOPE_VERSION,
  };
  const passthrough = [
    'serviceName',
    'serviceVersion',
    'environment',
    'applicationId',
    'sessionSampleRate',
    'sessionTimeoutMinutes',
    'longTaskThresholdMs',
    'anrThresholdMs',
    'metricExportIntervalMs',
    'logExportScheduledDelayMs',
    'exportIntervalSeconds',
    'metricExportIntervalSeconds',
    'traceExportIntervalMs',
    'vitalsCollectionIntervalSeconds',
    'maxExportBatchSize',
    'maxQueueSize',
    'enableErrorTracking',
    'enableLifecycleTracking',
    'enableStartupTracking',
    'enableAutoTapTracking',
    'enableLongTaskDetection',
    'enableAnrDetection',
    'enableFrameMetrics',
    'enableMemoryMetrics',
    'enableCpuMetrics',
    'enableWebVitals',
    'enableBatteryTracking',
    'enableNetworkTracking',
    'enableConnectivityTracking',
    'enablePerformanceMetrics',
    'enableLogging',
    'captureConsole',
    'capturePrintStatements',
    'maxOfflineStorageMb',
    'secure',
  ];
  for (const k of passthrough) {
    if (cfg[k] != null) attrs[`scout.config.${snake(k)}`] = cfg[k] as never;
  }
  // Delivery semantics — the two knobs that decide at-most-once vs at-least-once.
  const retry = cfg['exportRetry'] as { maxRetries?: number } | undefined;
  const offline = cfg['offlineBuffer'] as { enabled?: boolean } | undefined;
  attrs['scout.config.export_max_retries'] = retry?.maxRetries ?? 0;
  attrs['scout.config.offline_buffer_enabled'] = !!offline?.enabled;
  attrs['scout.config.use_before_send'] = !!cfg['beforeSend'];
  attrs['scout.config.use_first_party_hosts'] =
    Array.isArray(cfg['firstPartyHosts']) &&
    (cfg['firstPartyHosts'] as unknown[]).length > 0;
  attrs['scout.config.first_party_hosts_count'] = Array.isArray(cfg['firstPartyHosts'])
    ? (cfg['firstPartyHosts'] as unknown[]).length
    : 0;
  attrs['scout.config.has_custom_resource_attributes'] = !!cfg['resourceAttributes'];
  attrs['scout.config.has_custom_headers'] =
    !!cfg['headers'] && Object.keys(cfg['headers'] as object).length > 0;
  attrs['scout.config.track_resources'] = !!cfg['enableNetworkTracking'];
  attrs['scout.config.track_long_task'] = !!cfg['enableLongTaskDetection'];
  attrs['scout.config.track_user_interactions'] = !!cfg['enableAutoTapTracking'];
  attrs['scout.config.track_frustrations'] = !!cfg['enableAutoTapTracking'];
  attrs['scout.config.track_views_manually'] = false;
  attrs['scout.config.track_errors'] = !!cfg['enableErrorTracking'];
  attrs['scout.config.track_native_errors'] = !!cfg['enableErrorTracking'];
  attrs['scout.config.track_native_long_tasks'] = !!cfg['enableLongTaskDetection'];
  attrs['scout.config.track_cross_platform_long_tasks'] =
    !!cfg['enableLongTaskDetection'];
  attrs['scout.config.track_network_requests'] = !!cfg['enableNetworkTracking'];
  attrs['scout.config.track_background_events'] = !!cfg['enableLifecycleTracking'];
  attrs['scout.config.track_anonymous_user'] = true;
  attrs['scout.config.forward_console_logs'] = !!cfg['captureConsole'];
  attrs['scout.config.forward_errors_to_logs'] = !!cfg['enableErrorTracking'];
  attrs['scout.config.use_tracing'] = true;
  attrs['scout.config.tracking_consent'] = 'granted';
  attrs['scout.config.session_persistence'] = 'local-storage';
  attrs['scout.config.selected_tracing_propagators'] = 'tracecontext';
  attrs['scout.config.trace_context_injection'] = 'all';
  attrs['scout.config.initialization_type'] = 'auto';
  attrs['scout.config.telemetry_sample_rate'] = 100;
  attrs['scout.config.telemetry_configuration_sample_rate'] = 100;
  attrs['scout.config.telemetry_usage_sample_rate'] = 100;
  scout.logInfo('scout.config', attrs as never);
}
const usageEmitted = new Set<string>();
export function emitScoutUsageOnce(scout: Scout, apiName: string): void {
  if (usageEmitted.has(apiName)) return;
  usageEmitted.add(apiName);
  scout.logInfo('scout.usage', {
    'scout.diag': true,
    'scout.usage.api': apiName,
  } as never);
}
export function resetScoutUsageTracking(): void {
  usageEmitted.clear();
}
function snake(camel: string): string {
  return camel.replace(/([A-Z])/g, '_$1').toLowerCase();
}
