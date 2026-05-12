import { describe, expect, it } from 'vitest';
import { uuidv4 } from './uuid';
describe('uuidv4', () => {
    it('returns a v4 UUID', () => {
        const id = uuidv4();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
    it('returns unique values on each call', () => {
        const set = new Set<string>();
        for (let i = 0; i < 1000; i++)
            set.add(uuidv4());
        expect(set.size).toBe(1000);
    });
});
