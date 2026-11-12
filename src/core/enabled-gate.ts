import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';

/**
 * The pipeline half of the runtime kill switch (`enabled` / `Scout.setEnabled`).
 *
 * The core stops producing telemetry the moment it is disabled, but spans
 * can also end outside its emit path (a root span or a tracked span started
 * while enabled), and the metric reader keeps collecting on its own timer.
 * This gate catches both, in two stages so a disable can still flush what was
 * recorded while enabled:
 *
 * - `accepting` follows the core's switch synchronously. While it is false,
 *   the processors below drop every span and log as it ends, so nothing
 *   produced after a disable is queued.
 * - `exporting` closes only once that flush has finished. While it is false,
 *   the exporters below never touch the network: the export reports SUCCESS
 *   without a request, so it is neither retried nor written to the offline
 *   buffer.
 */
export class EnabledGate {
  private source: { readonly enabled: boolean } | null = null;
  private _accepting: boolean;
  private _exporting: boolean;

  constructor(initiallyEnabled: boolean) {
    this._accepting = initiallyEnabled;
    this._exporting = initiallyEnabled;
  }

  /** Follow `source.enabled` from now on. */
  bind(source: { readonly enabled: boolean }): void {
    this.source = source;
  }

  get accepting(): boolean {
    return this.source ? this.source.enabled : this._accepting;
  }

  get exporting(): boolean {
    return this._exporting;
  }

  setExporting(open: boolean): void {
    this._exporting = open;
  }
}

interface GatableExporter {
  export(items: any, callback: (result: ExportResult) => void): void;
}

/**
 * Closes `exporter` behind `gate.exporting`. Mutates and returns the same
 * object, as `wrapWithRetry` does, so the metric exporter keeps its
 * temporality and aggregation selectors.
 */
export function gateExporter<E extends GatableExporter>(
  exporter: E,
  gate: EnabledGate,
): E {
  const originalExport = exporter.export.bind(exporter);
  exporter.export = (items: unknown, callback: (result: ExportResult) => void): void => {
    if (!gate.exporting) {
      callback({ code: ExportResultCode.SUCCESS });
      return;
    }
    originalExport(items, callback);
  };
  return exporter;
}

/** Drops spans that end while the gate is not accepting. */
export class GatedSpanProcessor implements SpanProcessor {
  constructor(
    private readonly inner: SpanProcessor,
    private readonly gate: EnabledGate,
  ) {}

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnding(span: Span): void {
    if (this.gate.accepting) this.inner.onEnding?.(span);
  }

  onEnd(span: ReadableSpan): void {
    if (this.gate.accepting) this.inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

/** Drops log records emitted while the gate is not accepting. */
export class GatedLogRecordProcessor implements LogRecordProcessor {
  constructor(
    private readonly inner: LogRecordProcessor,
    private readonly gate: EnabledGate,
  ) {}

  onEmit(logRecord: SdkLogRecord, context?: Context): void {
    if (this.gate.accepting) this.inner.onEmit(logRecord, context);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}
