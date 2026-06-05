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
    expect(r.enableFrameMetrics).toBe(true);
    expect(r.enableBatteryTracking).toBe(true);
    expect(r.enableNetworkTracking).toBe(true);
    expect(r.enableLogging).toBe(true);
    expect(r.captureConsole).toBe(false);
    expect(r.sessionSampleRate).toBe(1);
    expect(r.sessionTimeoutMinutes).toBe(30);
    expect(r.maxSessionDurationMinutes).toBe(60);
    expect(r.alwaysCaptureErrors).toBe(true);
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
