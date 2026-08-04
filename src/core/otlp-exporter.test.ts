import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import {
  createOtlpTraceExporter,
  createOtlpLogExporter,
  createOtlpMetricExporter,
} from './otlp-exporter';
import { AggregationTemporality, InstrumentType } from '@opentelemetry/sdk-metrics';

// The serializers only need enough shape to produce a non-empty payload;
// what these tests lock is delivery behaviour, not OTLP encoding.
vi.mock('@opentelemetry/otlp-transformer', () => ({
  JsonTraceSerializer: {
    serializeRequest: (items: unknown) =>
      new TextEncoder().encode(JSON.stringify({ kind: 'traces', n: len(items) })),
  },
  JsonLogsSerializer: {
    // `ISerializer.serializeRequest` may legally return undefined; the empty
    // array is this mock's way of reaching that branch.
    serializeRequest: (items: unknown) =>
      len(items) === 0
        ? undefined
        : new TextEncoder().encode(JSON.stringify({ kind: 'logs', n: len(items) })),
  },
  JsonMetricsSerializer: {
    serializeRequest: () => new TextEncoder().encode(JSON.stringify({ kind: 'metrics' })),
  },
}));

function len(items: unknown): number {
  return Array.isArray(items) ? items.length : 1;
}

const OPTS = { url: 'https://collector.test/v1/traces', timeoutMillis: 5000 };

function exportOnce(
  exporter: { export: (items: never, cb: (r: ExportResult) => void) => void },
  items: unknown = [{ a: 1 }],
): Promise<ExportResult> {
  return new Promise((resolve) => exporter.export(items as never, resolve));
}

describe('otlp-exporter — at-most-once delivery', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends exactly one request per export and reports SUCCESS', async () => {
    const result = await exportOnce(createOtlpTraceExporter(OPTS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.code).toBe(ExportResultCode.SUCCESS);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(OPTS.url);
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('sends exactly one request on a 500 — no internal retry layer', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const result = await exportOnce(createOtlpTraceExporter(OPTS));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.code).toBe(ExportResultCode.FAILED);
    // .status is what retry-exporter's isRetryableError classifies on.
    expect((result.error as { status?: number }).status).toBe(500);
  });

  it.each([429, 502, 503, 504])(
    'sends exactly one request on %i (the statuses the stock RetryingTransport retried)',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('', { status }));
      const result = await exportOnce(createOtlpTraceExporter(OPTS));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.code).toBe(ExportResultCode.FAILED);
    },
  );

  it('never re-sends a batch under timeout-then-recover', async () => {
    // The duplicate-span case: the first export times out (the collector may
    // already have ingested it), the second succeeds. Each export must put
    // its own batch on the wire exactly once and never replay the first.
    fetchMock
      .mockRejectedValueOnce(new Error('Aborted due to timeout'))
      .mockResolvedValue(new Response('', { status: 200 }));
    const exporter = createOtlpTraceExporter(OPTS);
    const first = await exportOnce(exporter, [{ span: 'a' }]);
    const second = await exportOnce(exporter, [{ span: 'b' }]);
    expect(first.code).toBe(ExportResultCode.FAILED);
    expect(second.code).toBe(ExportResultCode.SUCCESS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((c) => c[1].body);
    expect(bodies).toEqual([
      JSON.stringify({ kind: 'traces', n: 1 }),
      JSON.stringify({ kind: 'traces', n: 1 }),
    ]);
    expect(new Set(bodies).size).toBe(1); // same shape, but two distinct exports
  });

  it('aborts the request when the timeout elapses', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const exporter = createOtlpTraceExporter({ ...OPTS, timeoutMillis: 1000 });
    const pending = exportOnce(exporter);
    await vi.advanceTimersByTimeAsync(1001);
    const result = await pending;
    expect(signal!.aborted).toBe(true);
    expect(result.code).toBe(ExportResultCode.FAILED);
    vi.useRealTimers();
  });

  it('drops exports after shutdown without touching the network', async () => {
    const exporter = createOtlpTraceExporter(OPTS);
    await exporter.shutdown();
    const result = await exportOnce(exporter);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.code).toBe(ExportResultCode.FAILED);
  });

  it('does not hit the network when serialization yields no payload', async () => {
    const exporter = createOtlpLogExporter({ ...OPTS, url: 'https://c.test/v1/logs' });
    const result = await new Promise<ExportResult>((resolve) =>
      exporter.export([], resolve),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.code).toBe(ExportResultCode.SUCCESS);
  });

  it('passes configured headers through alongside content-type', async () => {
    const exporter = createOtlpLogExporter({
      url: 'https://c.test/v1/logs',
      headers: { authorization: 'Bearer t' },
    });
    await exportOnce(exporter);
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer t',
    });
  });

  it('keeps the stock exporter’s CUMULATIVE temporality', () => {
    const exporter = createOtlpMetricExporter({ url: 'https://c.test/v1/metrics' });
    for (const t of [
      InstrumentType.COUNTER,
      InstrumentType.HISTOGRAM,
      InstrumentType.OBSERVABLE_GAUGE,
      InstrumentType.UP_DOWN_COUNTER,
    ]) {
      expect(exporter.selectAggregationTemporality!(t)).toBe(
        AggregationTemporality.CUMULATIVE,
      );
    }
  });
});
