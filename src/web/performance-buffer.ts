const consumed = new Set<string>();
const CLAIM_KEY_MAX = 1000;
function key(url: string, startTime: number) {
    return `${url}@${Math.round(startTime * 1000) / 1000}`;
}
export function claimResourceEntry(url: string, fetchStart: number): PerformanceResourceTiming | null {
    if (typeof performance === 'undefined' || !performance.getEntriesByName) {
        return null;
    }
    let entries: PerformanceEntryList;
    try {
        entries = performance.getEntriesByName(url, 'resource');
    }
    catch {
        return null;
    }
    let best: PerformanceResourceTiming | null = null;
    let bestStart = -Infinity;
    for (const e of entries) {
        if (e.entryType !== 'resource')
            continue;
        const r = e as PerformanceResourceTiming;
        if (r.startTime + 2 < fetchStart)
            continue;
        if (consumed.has(key(r.name, r.startTime)))
            continue;
        if (r.startTime > bestStart) {
            bestStart = r.startTime;
            best = r;
        }
    }
    if (best) {
        consumed.add(key(best.name, best.startTime));
        if (consumed.size > CLAIM_KEY_MAX) {
            const arr = Array.from(consumed);
            consumed.clear();
            for (const k of arr.slice(arr.length / 2))
                consumed.add(k);
        }
    }
    return best;
}
export function startPerformanceBuffer(): () => void {
    return () => {
        consumed.clear();
    };
}
