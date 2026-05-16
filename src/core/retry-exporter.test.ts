import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { wrapWithRetry } from './retry-exporter';
interface MockExporter {
    export(items: unknown, cb: (r: ExportResult) => void): void;
}
const RETRY_OPTS = { maxRetries: 3, initialDelayMs: 10, maxDelayMs: 100 };
describe('wrapWithRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    it('passes SUCCESS through immediately', () => {
        const inner = vi.fn((_items: unknown, cb: (r: ExportResult) => void) => cb({ code: ExportResultCode.SUCCESS }));
        const exporter: MockExporter = { export: inner };
        const wrapped = wrapWithRetry(exporter, RETRY_OPTS);
        const cb = vi.fn();
        wrapped.export([{}], cb);
        expect(inner).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
    });
    it('retries on transient network error, then succeeds', async () => {
        let calls = 0;
        const inner = vi.fn((_items: unknown, cb: (r: ExportResult) => void) => {
            calls += 1;
            if (calls < 3) {
                cb({ code: ExportResultCode.FAILED, error: new Error('network timeout') });
            }
            else {
                cb({ code: ExportResultCode.SUCCESS });
            }
        });
        const exporter: MockExporter = { export: inner };
        const wrapped = wrapWithRetry(exporter, RETRY_OPTS);
        const cb = vi.fn();
        wrapped.export([{}], cb);
        await vi.runAllTimersAsync();
        expect(inner).toHaveBeenCalledTimes(3);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
    });
    it('retries on 503 / 5xx', async () => {
        let calls = 0;
        const inner = vi.fn((_items: unknown, cb: (r: ExportResult) => void) => {
            calls += 1;
            if (calls === 1) {
                cb({ code: ExportResultCode.FAILED, error: { status: 503 } as Error });
            }
            else {
                cb({ code: ExportResultCode.SUCCESS });
            }
        });
        const exporter: MockExporter = { export: inner };
        const wrapped = wrapWithRetry(exporter, RETRY_OPTS);
        const cb = vi.fn();
        wrapped.export([{}], cb);
        await vi.runAllTimersAsync();
        expect(inner).toHaveBeenCalledTimes(2);
        expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
    });
    it('does NOT retry on 4xx (other than 408 / 429)', () => {
        const inner = vi.fn((_items: unknown, cb: (r: ExportResult) => void) => cb({ code: ExportResultCode.FAILED, error: { status: 400 } as Error }));
        const exporter: MockExporter = { export: inner };
        const wrapped = wrapWithRetry(exporter, RETRY_OPTS);
        const cb = vi.fn();
        wrapped.export([{}], cb);
        expect(inner).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({
            code: ExportResultCode.FAILED,
            error: { status: 400 } as Error,
        });
    });
    it('retries on 408 and 429', async () => {
        for (const status of [408, 429]) {
            let calls = 0;
            const inner = vi.fn((_items: unknown, cb: (r: ExportResult) => void) => {
                calls += 1;
                if (calls === 1)
                    cb({ code: ExportResultCode.FAILED, error: { status } as Error });
                else
                    cb({ code: ExportResultCode.SUCCESS });
            });
            const wrapped = wrapWithRetry({ export: inner } as MockExporter, RETRY_OPTS);
            wrapped.export([{}], () => { });
            await vi.runAllTimersAsync();
            expect(inner).toHaveBeenCalledTimes(2);
        }
    });
    it('gives up after maxRetries', async () => {
        const inner = vi.fn((_items: unknown, cb: (r: ExportResult) => void) => cb({ code: ExportResultCode.FAILED, error: new Error('network error') }));
        const wrapped = wrapWithRetry({ export: inner } as MockExporter, RETRY_OPTS);
        const cb = vi.fn();
        wrapped.export([{}], cb);
        await vi.runAllTimersAsync();
        expect(inner).toHaveBeenCalledTimes(4);
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0]![0].code).toBe(ExportResultCode.FAILED);
    });
    it('is a no-op pass-through when maxRetries=0', () => {
        const inner = vi.fn((_items: unknown, cb: (r: ExportResult) => void) => cb({ code: ExportResultCode.FAILED, error: new Error('network error') }));
        const exporter: MockExporter = { export: inner };
        const wrapped = wrapWithRetry(exporter, {
            maxRetries: 0,
            initialDelayMs: 10,
            maxDelayMs: 100,
        });
        expect(wrapped).toBe(exporter);
        const cb = vi.fn();
        wrapped.export([{}], cb);
        expect(inner).toHaveBeenCalledTimes(1);
        expect(cb.mock.calls[0]![0].code).toBe(ExportResultCode.FAILED);
    });
});
