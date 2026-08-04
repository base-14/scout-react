import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { ResolvedRetry } from './config';
interface RetryableExporter {
  export(items: unknown, callback: (result: ExportResult) => void): void;
}
export interface RetryHooks {
  onFailedAfterRetries?: (items: unknown) => void;
  debug?: boolean;
  label?: string;
}
export function wrapWithRetry<E extends RetryableExporter>(
  exporter: E,
  opts: ResolvedRetry,
  hooks: RetryHooks = {},
): E {
  // At zero retries the wrapper still has work to do when an offline hook or
  // debug logging is wired up: it makes exactly one attempt and then hands
  // retryable failures to `onFailedAfterRetries`, which is what feeds the
  // offline buffer. Skipping the wrap here would silently disable buffering
  // for integrators who re-enable it on top of the at-most-once default.
  if (opts.maxRetries <= 0 && !hooks.onFailedAfterRetries && !hooks.debug) {
    return exporter;
  }
  const originalExport = exporter.export.bind(exporter);
  const label = hooks.label ?? 'export';
  (exporter as RetryableExporter).export = function (
    items: unknown,
    callback: (result: ExportResult) => void,
  ): void {
    let attempt = 0;
    const count = Array.isArray(items) ? items.length : 1;
    const tryOnce = (): void => {
      if (hooks.debug)
        console.log('[scout]', label, 'attempt', attempt + 1, 'items', count);
      originalExport(items, (result: ExportResult) => {
        if (result.code === ExportResultCode.SUCCESS) {
          if (hooks.debug) console.log('[scout]', label, 'OK items=' + count);
          callback(result);
          return;
        }
        if (hooks.debug) {
          console.warn(
            '[scout]',
            label,
            'FAIL',
            String(
              (result.error as { message?: string })?.message ??
                result.error ??
                'unknown',
            ),
          );
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
