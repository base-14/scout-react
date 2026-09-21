import { describe, expect, it } from 'vitest';
import { EXIT_SPAN_KEY, toAppExitAttributes } from './native-crash';
import { SPAN } from '../../core/spans';

describe('toAppExitAttributes', () => {
  it('renames crash.* to exit.* with reason/description for the OS name and text', () => {
    const out = toAppExitAttributes({
      'crash.type': 'low_memory',
      'crash.reason': 'low memory',
      'crash.source': 'exit_info',
      'crash.importance': 400,
      'crash.pid': 15538,
      'crash.timestamp': '2026-09-19T13:54:14.244Z',
      'error.stack_trace': '',
      breadcrumbs: '[]',
    });
    expect(out).toEqual({
      'exit.reason': 'low_memory',
      'exit.description': 'low memory',
      'exit.source': 'exit_info',
      'exit.importance': 400,
      'exit.pid': 15538,
      'exit.timestamp': '2026-09-19T13:54:14.244Z',
      breadcrumbs: '[]',
    });
    expect(Object.keys(out).some((k) => k.startsWith('crash.'))).toBe(false);
  });

  it('span marker matches the Kotlin collector contract', () => {
    expect(EXIT_SPAN_KEY).toBe('scout.span');
    expect(SPAN.APP_EXIT).toBe('app_exit');
  });
});
