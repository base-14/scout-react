import type { Scout } from '../../core/scout';
import type { SeverityText } from '../../core/types';
export function installNativeConsoleCapture(scout: Scout): () => void {
  if (typeof console === 'undefined') return () => {};
  const wrap = (
    method: 'debug' | 'log' | 'info' | 'warn' | 'error',
    severity: SeverityText,
  ) => {
    const orig = (console as any)[method];
    (console as any)[method] = (...args: unknown[]) => {
      // The SDK's own `[scout]` diagnostics must never be captured: each
      // export would log, which would emit a log, which would export again.
      if (!isScoutDiagnostic(args)) {
        try {
          scout.emitLog(severity, args.map(stringify).join(' '));
        } catch {}
      }
      return orig.apply(console, args);
    };
    return () => {
      (console as any)[method] = orig;
    };
  };
  const restorers = [
    wrap('debug', 'DEBUG'),
    wrap('log', 'INFO'),
    wrap('info', 'INFO'),
    wrap('warn', 'WARN'),
    wrap('error', 'ERROR'),
  ];
  return () => restorers.forEach((r) => r());
}
export function isScoutDiagnostic(args: unknown[]): boolean {
  return typeof args[0] === 'string' && args[0].startsWith('[scout]');
}
function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
