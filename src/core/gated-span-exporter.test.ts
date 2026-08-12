import { describe, it, expect, vi } from 'vitest';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { GatedSpanExporter } from './gated-span-exporter';

function mockExporter() {
  return {
    export: vi.fn((_items: unknown, cb: (r: ExportResult) => void) =>
      cb({ code: ExportResultCode.SUCCESS }),
    ),
    shutdown: vi.fn(() => Promise.resolve()),
    forceFlush: vi.fn(() => Promise.resolve()),
  };
}

describe('GatedSpanExporter', () => {
  it('passes exports through while open', () => {
    const inner = mockExporter();
    const gated = new GatedSpanExporter(inner);
    const cb = vi.fn();
    gated.export([{}], cb);
    expect(inner.export).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('starts open', () => {
    expect(new GatedSpanExporter(mockExporter()).isOpen).toBe(true);
  });

  it('drops exports once closed, without touching the inner exporter', () => {
    const inner = mockExporter();
    const gated = new GatedSpanExporter(inner);
    gated.setOpen(false);
    const cb = vi.fn();
    gated.export([{}], cb);
    expect(inner.export).not.toHaveBeenCalled();
    expect(gated.isOpen).toBe(false);
  });

  it('reports SUCCESS for dropped batches so the buffer does not hoard them', () => {
    const gated = new GatedSpanExporter(mockExporter());
    gated.setOpen(false);
    const cb = vi.fn();
    gated.export([{}, {}], cb);
    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('resumes exporting when reopened', () => {
    const inner = mockExporter();
    const gated = new GatedSpanExporter(inner);
    gated.setOpen(false);
    gated.export([{}], vi.fn());
    gated.setOpen(true);
    gated.export([{}], vi.fn());
    expect(inner.export).toHaveBeenCalledTimes(1);
  });

  it('forwards shutdown and forceFlush to the inner exporter', async () => {
    const inner = mockExporter();
    const gated = new GatedSpanExporter(inner);
    await gated.shutdown();
    await gated.forceFlush();
    expect(inner.shutdown).toHaveBeenCalledTimes(1);
    expect(inner.forceFlush).toHaveBeenCalledTimes(1);
  });

  it('flushes and shuts down even while closed', async () => {
    const inner = mockExporter();
    const gated = new GatedSpanExporter(inner);
    gated.setOpen(false);
    await expect(gated.forceFlush()).resolves.toBeUndefined();
    await expect(gated.shutdown()).resolves.toBeUndefined();
    expect(inner.shutdown).toHaveBeenCalledTimes(1);
  });

  it('tolerates an inner exporter with no shutdown/forceFlush', async () => {
    const bare = {
      export: vi.fn((_i: unknown, cb: (r: ExportResult) => void) =>
        cb({ code: ExportResultCode.SUCCESS }),
      ),
    };
    const gated = new GatedSpanExporter(bare);
    await expect(gated.shutdown()).resolves.toBeUndefined();
    await expect(gated.forceFlush()).resolves.toBeUndefined();
  });
});
