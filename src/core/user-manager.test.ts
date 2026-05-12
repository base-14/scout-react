import { describe, expect, it } from 'vitest';
import { UserManager } from './user-manager';
describe('UserManager', () => {
    it('starts empty', () => {
        const u = new UserManager();
        expect(u.id).toBeNull();
        expect(u.attributes).toEqual({});
    });
    it('stores id and attributes via set()', () => {
        const u = new UserManager();
        u.set('user-1', { email: 'a@b.c', plan: 'pro' });
        expect(u.id).toBe('user-1');
        expect(u.attributes).toEqual({ email: 'a@b.c', plan: 'pro' });
    });
    it('replaces attributes on subsequent set() calls', () => {
        const u = new UserManager();
        u.set('user-1', { a: 1 });
        u.set('user-2', { b: 2 });
        expect(u.id).toBe('user-2');
        expect(u.attributes).toEqual({ b: 2 });
    });
    it('clears id and attributes', () => {
        const u = new UserManager();
        u.set('user-1', { a: 1 });
        u.clear();
        expect(u.id).toBeNull();
        expect(u.attributes).toEqual({});
    });
    it('does not leak the internal attributes object', () => {
        const u = new UserManager();
        const input = { a: 1 };
        u.set('user-1', input);
        input.a = 999;
        expect(u.attributes).toEqual({ a: 1 });
    });
});
