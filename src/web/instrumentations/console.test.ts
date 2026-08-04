import { describe, it, expect, vi, afterEach } from 'vitest';
import { installConsoleCapture } from './console';
import type { Scout } from '../../core/scout';

function fakeScout(): { scout: Scout; emitLog: ReturnType<typeof vi.fn> } {
  const emitLog = vi.fn();
  return { scout: { emitLog } as unknown as Scout, emitLog };
}

describe('console capture', () => {
  const restorers: Array<() => void> = [];
  afterEach(() => {
    restorers.splice(0).forEach((r) => r());
    vi.restoreAllMocks();
  });

  it('captures ordinary console output', () => {
    const { scout, emitLog } = fakeScout();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    restorers.push(installConsoleCapture(scout));
    console.log('hello', 42);
    expect(emitLog).toHaveBeenCalledWith('INFO', 'hello 42');
  });

  it('does NOT capture the SDK’s own [scout] diagnostics', () => {
    // Otherwise every export logs, every log emits, and every emit exports:
    // a self-sustaining feedback loop under `captureConsole` + `debug`.
    const { scout, emitLog } = fakeScout();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    restorers.push(installConsoleCapture(scout));
    console.log('[scout]', 'traces', 'attempt', 1);
    console.warn('[scout] traces FAIL');
    expect(emitLog).not.toHaveBeenCalled();
  });

  it('still forwards [scout] lines to the original console', () => {
    const { scout } = fakeScout();
    const original = vi.spyOn(console, 'log').mockImplementation(() => {});
    restorers.push(installConsoleCapture(scout));
    console.log('[scout]', 'traces OK');
    expect(original).toHaveBeenCalledWith('[scout]', 'traces OK');
  });

  it('captures a message that merely contains [scout] later in the string', () => {
    const { scout, emitLog } = fakeScout();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    restorers.push(installConsoleCapture(scout));
    console.log('app said [scout] something');
    expect(emitLog).toHaveBeenCalledTimes(1);
  });
});
