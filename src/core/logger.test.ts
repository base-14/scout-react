import { describe, expect, it } from 'vitest';
import { SEVERITY_NUMBER, nowNanos } from './logger';
describe('logger constants', () => {
    it('uses OTel-spec severity numbers', () => {
        expect(SEVERITY_NUMBER.DEBUG).toBe(5);
        expect(SEVERITY_NUMBER.INFO).toBe(9);
        expect(SEVERITY_NUMBER.WARN).toBe(13);
        expect(SEVERITY_NUMBER.ERROR).toBe(17);
    });
});
describe('nowNanos', () => {
    it('returns a decimal string ending in six zeros (ms→ns)', () => {
        const v = nowNanos();
        expect(v).toMatch(/^\d+000000$/);
    });
    it('returns a value close to Date.now() * 1e6', () => {
        const before = Date.now();
        const v = BigInt(nowNanos());
        const after = Date.now();
        expect(Number(v / 1000000n)).toBeGreaterThanOrEqual(before);
        expect(Number(v / 1000000n)).toBeLessThanOrEqual(after);
    });
});
