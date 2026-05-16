import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OfflineBuffer, type Storage } from './offline-buffer';
class MemoryStorage implements Storage {
    data = new Map<string, string>();
    async getItem(key: string) {
        return this.data.get(key) ?? null;
    }
    async setItem(key: string, value: string) {
        this.data.set(key, value);
    }
    async removeItem(key: string) {
        this.data.delete(key);
    }
}
const CAPS = { traces: 100, metrics: 50, logs: 100 };
describe('OfflineBuffer', () => {
    let storage: MemoryStorage;
    let buffer: OfflineBuffer;
    beforeEach(() => {
        storage = new MemoryStorage();
        buffer = new OfflineBuffer(storage, CAPS);
    });
    it('enqueues a batch and reports size', async () => {
        await buffer.enqueue('traces', 'payload-1', 10);
        expect(await buffer.size('traces')).toEqual({ batches: 1, items: 10 });
    });
    it('FIFO-drops the oldest batch when item cap is exceeded', async () => {
        await buffer.enqueue('traces', 'p1', 40);
        await buffer.enqueue('traces', 'p2', 40);
        await buffer.enqueue('traces', 'p3', 40);
        const size = await buffer.size('traces');
        expect(size.batches).toBe(2);
        expect(size.items).toBe(80);
    });
    it('keeps at least one batch even if a single batch exceeds the cap', async () => {
        await buffer.enqueue('traces', 'oversized', 500);
        const size = await buffer.size('traces');
        expect(size.batches).toBe(1);
        expect(size.items).toBe(500);
    });
    it('isolates per-signal namespaces', async () => {
        await buffer.enqueue('traces', 'pt', 5);
        await buffer.enqueue('metrics', 'pm', 7);
        expect((await buffer.size('traces')).items).toBe(5);
        expect((await buffer.size('metrics')).items).toBe(7);
        expect((await buffer.size('logs')).items).toBe(0);
    });
    it('drains successfully and clears storage', async () => {
        await buffer.enqueue('traces', 'p1', 5);
        await buffer.enqueue('traces', 'p2', 7);
        const fetchMock = vi.fn(() => Promise.resolve(new Response('ok', { status: 200 })));
        vi.stubGlobal('fetch', fetchMock);
        const result = await buffer.drain('traces', 'http://collector/v1/traces', {
            'x-api-key': 'k',
        });
        expect(result.sent).toBe(2);
        expect(result.remaining).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect((await buffer.size('traces')).batches).toBe(0);
        vi.unstubAllGlobals();
    });
    it('stops on first 5xx and retains the unsent batches', async () => {
        await buffer.enqueue('traces', 'p1', 5);
        await buffer.enqueue('traces', 'p2', 7);
        await buffer.enqueue('traces', 'p3', 9);
        let callIdx = 0;
        const fetchMock = vi.fn(() => {
            callIdx += 1;
            if (callIdx === 2)
                return Promise.resolve(new Response('err', { status: 503 }));
            return Promise.resolve(new Response('ok', { status: 200 }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await buffer.drain('traces', 'http://collector/v1/traces', {});
        expect(result.sent).toBe(1);
        expect(result.remaining).toBe(2);
        expect((await buffer.size('traces')).items).toBe(7 + 9);
        vi.unstubAllGlobals();
    });
    it('stops on fetch throw and retains everything', async () => {
        await buffer.enqueue('traces', 'p1', 5);
        const fetchMock = vi.fn(() => Promise.reject(new Error('network')));
        vi.stubGlobal('fetch', fetchMock);
        const result = await buffer.drain('traces', 'http://collector/v1/traces', {});
        expect(result.sent).toBe(0);
        expect(result.remaining).toBe(1);
        expect((await buffer.size('traces')).items).toBe(5);
        vi.unstubAllGlobals();
    });
    it('treats a corrupt JSON entry as empty (best-effort)', async () => {
        storage.data.set('scout.offline.traces', '{not json');
        expect(await buffer.size('traces')).toEqual({ batches: 0, items: 0 });
        await buffer.enqueue('traces', 'p1', 3);
        expect((await buffer.size('traces')).items).toBe(3);
    });
    it('is a no-op when the per-signal cap is 0', async () => {
        const zeroBuffer = new OfflineBuffer(storage, { traces: 0, metrics: 0, logs: 0 });
        await zeroBuffer.enqueue('traces', 'p1', 5);
        expect((await zeroBuffer.size('traces')).items).toBe(0);
    });
    it('clear() wipes a signal namespace', async () => {
        await buffer.enqueue('traces', 'p1', 5);
        await buffer.clear('traces');
        expect((await buffer.size('traces')).batches).toBe(0);
    });
});
