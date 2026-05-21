import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { ResolvedRetry } from './config';
interface RetryableExporter {
  export(items: unknown, callback: (result: ExportResult) => void): void;
}
export interface RetryHooks {
  onFailedAfterRetries?: (items: unknown) => void;
}
export function wrapWithRetry<E extends RetryableExporter>(
  exporter: E,
  opts: ResolvedRetry,
  hooks: RetryHooks = {},
): E {
  if (opts.maxRetries <= 0) return exporter;
  const originalExport = exporter.export.bind(exporter);
  (exporter as RetryableExporter).export = function (
    items: unknown,
    callback: (result: ExportResult) => void,
  ): void {
    let attempt = 0;
    const tryOnce = (): void => {
      originalExport(items, (result: ExportResult) => {
        if (result.code === ExportResultCode.SUCCESS) {
          callback(result);
          return;
        }
        if (attempt >= opts.maxRetries || !isRetryableError(result.error)) {
          if (isRetryableError(result.error) && hooks.onFailedAfterRetries) {
            try {
              hooks.onFailedAfterRetries(items);
            } catch {}
          }
          callback(result);
          return;
        }
        attempt += 1;
        const base = Math.min(opts.maxDelayMs, opts.initialDelayMs * 2 ** (attempt - 1));
        const delay = Math.floor(Math.random() * base);
        setTimeout(tryOnce, delay);
      });
    };
    tryOnce();
  };
  return exporter;
}
function isRetryableError(err: unknown): boolean {
  if (!err) return true;
  const code =
    (
      err as {
        status?: number;
      }
    ).status ??
    (
      err as {
        statusCode?: number;
      }
    ).statusCode ??
    (
      err as {
        code?: unknown;
      }
    ).code;
  if (typeof code === 'number') {
    return code === 408 || code === 429 || (code >= 500 && code < 600);
  }
  const message = String(
    (
      err as {
        message?: string;
      }
    ).message ?? err,
  );
  return /network|abort|timeout|fetch|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message);
}
