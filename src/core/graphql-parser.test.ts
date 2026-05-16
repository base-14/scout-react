import { describe, it, expect } from 'vitest';
import { parseGraphQLRequest, parseGraphQLResponse } from './graphql-parser';
describe('parseGraphQLRequest', () => {
    it('detects a query operation and pulls operationName from the body', () => {
        const body = JSON.stringify({
            query: 'query GetUser($id: ID!) { user(id: $id) { name } }',
            operationName: 'GetUser',
            variables: { id: '42' },
        });
        const r = parseGraphQLRequest(body);
        expect(r?.operationType).toBe('query');
        expect(r?.operationName).toBe('GetUser');
        expect(r?.variables).toEqual({ id: '42' });
    });
    it('falls back to operationName from query body', () => {
        const body = JSON.stringify({
            query: 'mutation UpdateProfile { updateProfile(name: "x") }',
        });
        const r = parseGraphQLRequest(body);
        expect(r?.operationType).toBe('mutation');
        expect(r?.operationName).toBe('UpdateProfile');
    });
    it('defaults to query when no leading keyword (shorthand syntax)', () => {
        const body = JSON.stringify({ query: '{ viewer { name } }' });
        const r = parseGraphQLRequest(body);
        expect(r?.operationType).toBe('query');
    });
    it('returns null for non-GraphQL JSON', () => {
        expect(parseGraphQLRequest(JSON.stringify({ foo: 'bar' }))).toBeNull();
    });
    it('returns null for non-string bodies / unparseable strings', () => {
        expect(parseGraphQLRequest(null)).toBeNull();
        expect(parseGraphQLRequest('not json')).toBeNull();
        expect(parseGraphQLRequest({ query: 'x' })).toBeNull();
    });
});
describe('parseGraphQLResponse', () => {
    it('reports zero errors for a clean response', () => {
        const r = parseGraphQLResponse(JSON.stringify({ data: { user: {} } }));
        expect(r?.errorCount).toBe(0);
        expect(r?.errors).toEqual([]);
    });
    it('reports error count and array', () => {
        const r = parseGraphQLResponse(JSON.stringify({ errors: [{ message: 'forbidden' }, { message: 'no auth' }] }));
        expect(r?.errorCount).toBe(2);
        expect(r?.errors[0]).toEqual({ message: 'forbidden' });
    });
    it('returns null for non-GraphQL bodies', () => {
        expect(parseGraphQLResponse(JSON.stringify({ foo: 1 }))).toBeNull();
        expect(parseGraphQLResponse('not json')).toBeNull();
    });
});
