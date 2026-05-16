import { describe, it, expect } from 'vitest';
import { lookupProvider } from './provider-lookup';
describe('lookupProvider', () => {
    it('matches apex hosts', () => {
        const p = lookupProvider('https://stripe.com/api/payments');
        expect(p?.name).toBe('stripe');
        expect(p?.type).toBe('utility');
    });
    it('matches subdomains of known providers', () => {
        const p = lookupProvider('https://fonts.googleapis.com/css?family=Inter');
        expect(p?.name).toBe('google-fonts');
        expect(p?.type).toBe('content');
    });
    it('returns null for unknown hosts', () => {
        expect(lookupProvider('https://example-internal.acme.com/api')).toBeNull();
    });
    it('returns null for malformed urls', () => {
        expect(lookupProvider('not a url')).toBeNull();
    });
    it('classifies analytics / ad / cdn / tag-manager separately', () => {
        expect(lookupProvider('https://google-analytics.com/collect')?.type).toBe('analytics');
        expect(lookupProvider('https://doubleclick.net/x')?.type).toBe('ad');
        expect(lookupProvider('https://d1234.cloudfront.net/static.js')?.type).toBe('cdn');
        expect(lookupProvider('https://googletagmanager.com/gtm.js')?.type).toBe('tag-manager');
    });
});
