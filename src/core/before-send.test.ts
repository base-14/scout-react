import { describe, expect, it, vi } from 'vitest';
import { applyBeforeSend } from './before-send';
describe('applyBeforeSend', () => {
  it('returns attributes unchanged when no callback provided', () => {
    const result = applyBeforeSend(undefined, 'span', 'foo', { a: 1 });
    expect(result).toEqual({ attributes: { a: 1 } });
  });
  it('drops the event when the callback returns null', () => {
    const cb = vi.fn(() => null);
    const result = applyBeforeSend(cb, 'span', 'foo', { a: 1 });
    expect(result).toBeNull();
    expect(cb).toHaveBeenCalledOnce();
  });
  it('passes type and name into the callback for filtering', () => {
    const cb = vi.fn((e) => e);
    applyBeforeSend(cb, 'log', 'login', { 'enduser.id': 'u1' });
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', name: 'login', 'enduser.id': 'u1' }),
    );
  });
  it('strips reserved type and name fields from returned attributes', () => {
    const cb = vi.fn((e) => ({ ...e, extra: 'ok' }));
    const result = applyBeforeSend(cb, 'span', 'foo', { a: 1 });
    expect(result?.attributes).not.toHaveProperty('type');
    expect(result?.attributes).not.toHaveProperty('name');
    expect(result?.attributes).toEqual({ a: 1, extra: 'ok' });
  });
  it('preserves severity and message for logs', () => {
    const cb = vi.fn((e) => e);
    const result = applyBeforeSend(
      cb,
      'log',
      'log',
      { ok: true },
      {
        severity: 'WARN',
        message: 'retrying',
      },
    );
    expect(result?.severity).toBe('WARN');
    expect(result?.message).toBe('retrying');
  });
  it('allows the callback to override severity and message', () => {
    const cb = vi.fn((e) => ({ ...e, severity: 'ERROR', message: 'rewritten' }));
    const result = applyBeforeSend(
      cb,
      'log',
      'log',
      {},
      {
        severity: 'WARN',
        message: 'old',
      },
    );
    expect(result?.severity).toBe('ERROR');
    expect(result?.message).toBe('rewritten');
  });
  it('falls back to passing attributes through when the callback throws', () => {
    const cb = vi.fn(() => {
      throw new Error('boom');
    });
    const result = applyBeforeSend(cb, 'span', 'foo', { a: 1 });
    expect(result).toEqual({ attributes: { a: 1 } });
  });
});
