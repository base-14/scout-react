import { describe, expect, it } from 'vitest';
import { resolveConfig, resolveEndpoint } from './config';
describe('resolveConfig', () => {
  it('applies sensible defaults', () => {
    const r = resolveConfig({
      serviceName: 'svc',
      endpoint: 'https://otlp.example.com',
    });
    expect(r.serviceVersion).toBe('1.0.0');
    expect(r.secure).toBe(true);
    expect(r.enableAutoTapTracking).toBe(true);
    expect(r.enableErrorTracking).toBe(true);
    expect(r.enableAnrDetection).toBe(true);
    expect(r.enableBatteryTracking).toBe(true);
    expect(r.enableNetworkTracking).toBe(true);
    expect(r.enableLogging).toBe(true);
    expect(r.captureConsole).toBe(false);
    expect(r.sessionSampleRate).toBe(1);
    expect(r.sessionTimeoutMinutes).toBe(30);
    expect(r.maxSessionDurationMinutes).toBe(60);
    expect(r.alwaysCaptureErrors).toBe(true);
  });
  it('ships the minimal-telemetry, at-most-once default profile', () => {
    // Locks the v0.1.12 default table (scout-flutter 0.1.23 parity). Changing
    // any of these silently changes every integrator's telemetry volume or
    // delivery semantics — it must be a deliberate, reviewed edit.
    const r = resolveConfig({ serviceName: 'svc', endpoint: 'https://otlp' });
    // Vitals metrics are opt-in: zero periodic metrics by default.
    expect(r.enableFrameMetrics).toBe(false);
    expect(r.enableMemoryMetrics).toBe(false);
    expect(r.enableCpuMetrics).toBe(false);
    // At-most-once: no retries, no offline buffer.
    expect(r.exportRetry.maxRetries).toBe(0);
    expect(r.offlineBuffer.enabled).toBe(false);
    expect(r.offlineBuffer.maxItems).toEqual({ traces: 0, metrics: 0, logs: 0 });
    // One 30s cadence for all three signals.
    expect(r.exportIntervalSeconds).toBe(30);
    expect(r.traceExportIntervalMs).toBe(30000);
    expect(r.logExportScheduledDelayMs).toBe(30000);
    expect(r.metricExportIntervalMs).toBe(30000);
    expect(r.traceMaxQueueSize).toBe(2048);
    expect(r.logMaxQueueSize).toBe(2048);
    expect(r.traceMaxExportBatchSize).toBe(512);
    expect(r.logMaxExportBatchSize).toBe(512);
    expect(r.vitalsCollectionIntervalSeconds).toBe(60);
  });
  it('applies exportIntervalSeconds to all three signals', () => {
    const r = resolveConfig({
      serviceName: 's',
      endpoint: 'e',
      exportIntervalSeconds: 10,
    });
    expect(r.traceExportIntervalMs).toBe(10000);
    expect(r.logExportScheduledDelayMs).toBe(10000);
    expect(r.metricExportIntervalMs).toBe(10000);
  });
  it('lets an explicit per-signal *Ms option win over the unified knob', () => {
    const r = resolveConfig({
      serviceName: 's',
      endpoint: 'e',
      exportIntervalSeconds: 10,
      traceExportIntervalMs: 5000,
    });
    expect(r.traceExportIntervalMs).toBe(5000);
    expect(r.logExportScheduledDelayMs).toBe(10000);
    expect(r.metricExportIntervalMs).toBe(10000);
  });
  it('lets metricExportIntervalSeconds override metrics only', () => {
    const r = resolveConfig({
      serviceName: 's',
      endpoint: 'e',
      exportIntervalSeconds: 10,
      metricExportIntervalSeconds: 60,
    });
    expect(r.metricExportIntervalMs).toBe(60000);
    expect(r.metricExportIntervalSeconds).toBe(60);
    expect(r.traceExportIntervalMs).toBe(10000);
  });
  it('applies unified maxQueueSize / maxExportBatchSize to traces and logs', () => {
    const r = resolveConfig({
      serviceName: 's',
      endpoint: 'e',
      maxQueueSize: 100,
      maxExportBatchSize: 50,
    });
    expect(r.traceMaxQueueSize).toBe(100);
    expect(r.logMaxQueueSize).toBe(100);
    expect(r.traceMaxExportBatchSize).toBe(50);
    expect(r.logMaxExportBatchSize).toBe(50);
  });
  it('clamps interval knobs to a 1s / 1s floor', () => {
    const r = resolveConfig({
      serviceName: 's',
      endpoint: 'e',
      exportIntervalSeconds: 0,
      vitalsCollectionIntervalSeconds: 0,
    });
    expect(r.exportIntervalSeconds).toBe(1);
    expect(r.traceExportIntervalMs).toBe(1000);
    expect(r.vitalsCollectionIntervalSeconds).toBe(1);
  });
  it('still honours opt-in retries and offline buffering', () => {
    const r = resolveConfig({
      serviceName: 's',
      endpoint: 'e',
      exportRetry: { maxRetries: 2 },
      offlineBuffer: { enabled: true, maxItems: { traces: 100 } },
    });
    expect(r.exportRetry.maxRetries).toBe(2);
    expect(r.offlineBuffer.enabled).toBe(true);
    expect(r.offlineBuffer.maxItems.traces).toBe(100);
  });
  it('clamps iosHangThresholdMs (0 disables, otherwise 50ms floor, default 250)', () => {
    expect(resolveConfig({ serviceName: 's', endpoint: 'e' }).iosHangThresholdMs).toBe(
      250,
    );
    expect(
      resolveConfig({ serviceName: 's', endpoint: 'e', iosHangThresholdMs: 0 })
        .iosHangThresholdMs,
    ).toBe(0);
    expect(
      resolveConfig({ serviceName: 's', endpoint: 'e', iosHangThresholdMs: 10 })
        .iosHangThresholdMs,
    ).toBe(50);
    expect(
      resolveConfig({ serviceName: 's', endpoint: 'e', iosHangThresholdMs: 500 })
        .iosHangThresholdMs,
    ).toBe(500);
  });
  it('clamps maxSessionDurationMinutes to a 0 floor (negatives disable)', () => {
    expect(
      resolveConfig({ serviceName: 's', endpoint: 'e', maxSessionDurationMinutes: -5 })
        .maxSessionDurationMinutes,
    ).toBe(0);
    expect(
      resolveConfig({ serviceName: 's', endpoint: 'e', maxSessionDurationMinutes: 0 })
        .maxSessionDurationMinutes,
    ).toBe(0);
    expect(
      resolveConfig({ serviceName: 's', endpoint: 'e', maxSessionDurationMinutes: 120 })
        .maxSessionDurationMinutes,
    ).toBe(120);
  });
  it('clamps longTaskThresholdMs to a 20ms floor', () => {
    const r = resolveConfig({
      serviceName: 'svc',
      endpoint: 'https://otlp',
      longTaskThresholdMs: 5,
    });
    expect(r.longTaskThresholdMs).toBe(20);
  });
  it('clamps anrThresholdMs to a 1000ms floor', () => {
    const r = resolveConfig({
      serviceName: 'svc',
      endpoint: 'https://otlp',
      anrThresholdMs: 500,
    });
    expect(r.anrThresholdMs).toBe(1000);
  });
  it('clamps sessionSampleRate to 0..100', () => {
    expect(
      resolveConfig({ serviceName: 's', endpoint: 'e', sessionSampleRate: -10 })
        .sessionSampleRate,
    ).toBe(0);
    expect(
      resolveConfig({ serviceName: 's', endpoint: 'e', sessionSampleRate: 500 })
        .sessionSampleRate,
    ).toBe(100);
    expect(
      resolveConfig({ serviceName: 's', endpoint: 'e', sessionSampleRate: 25 })
        .sessionSampleRate,
    ).toBe(25);
  });
  it('treats capturePrintStatements as an alias for captureConsole', () => {
    const r = resolveConfig({
      serviceName: 'svc',
      endpoint: 'https://otlp',
      capturePrintStatements: true,
    });
    expect(r.captureConsole).toBe(true);
    expect(r.capturePrintStatements).toBe(true);
  });
  it('prefers captureConsole when both are provided', () => {
    const r = resolveConfig({
      serviceName: 'svc',
      endpoint: 'https://otlp',
      captureConsole: true,
      capturePrintStatements: false,
    });
    expect(r.captureConsole).toBe(true);
  });
});
describe('resolveEndpoint', () => {
  it('keeps a fully-qualified https URL', () => {
    expect(resolveEndpoint('https://otlp.example.com:4318', true)).toBe(
      'https://otlp.example.com:4318',
    );
  });
  it('keeps a fully-qualified http URL even when secure=true', () => {
    expect(resolveEndpoint('http://localhost:4318', true)).toBe('http://localhost:4318');
  });
  it('prepends https when secure=true and no scheme', () => {
    expect(resolveEndpoint('otlp.example.com:4318', true)).toBe(
      'https://otlp.example.com:4318',
    );
  });
  it('prepends http when secure=false and no scheme', () => {
    expect(resolveEndpoint('localhost:4318', false)).toBe('http://localhost:4318');
  });
});
