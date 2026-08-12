import { ExportResultCode, type ExportResult } from '@opentelemetry/core';

interface GatableExporter {
  export(items: unknown, callback: (result: ExportResult) => void): void;
  shutdown?(): Promise<void>;
  forceFlush?(): Promise<void>;
}

/**
 * A gate the WebView bridge can close at runtime.
 *
 * When a Flutter/native host relays this page's spans through its own
 * pipeline (`setWebViewBridge({ send, relay: true })`), the browser must
 * stop POSTing the same spans to the collector — otherwise every
 * interaction lands in the backend twice, once under the web service name
 * and once re-emitted natively.
 *
 * The gate sits at the exporter rather than at the emit path on purpose:
 * spans are still created, sampled, parented and assigned trace + span
 * ids, so `startTrackedSpan`'s `traceparent` injection keeps working and
 * backend spans still parent under the browser request. Only the network
 * write is suppressed.
 *
 * Closed exports report SUCCESS. The batch processor treats a dropped
 * batch as delivered, which is correct here — the host owns delivery — and
 * keeps the offline buffer from hoarding spans that were never meant to go
 * out over HTTP.
 */
export class GatedSpanExporter<E extends GatableExporter> {
  private _open = true;

  constructor(private readonly inner: E) {}

  /** Whether spans are still being written to the collector. */
  get isOpen(): boolean {
    return this._open;
  }

  /** Close the gate (host relays) or reopen it (host detached). */
  setOpen(open: boolean): void {
    this._open = open;
  }

  export(items: unknown, callback: (result: ExportResult) => void): void {
    if (!this._open) {
      callback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.inner.export(items, callback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown?.() ?? Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}
