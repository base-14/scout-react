import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { SpanStatusCode } from '@opentelemetry/api';
export function installNativeNetworkTracker(scout: Scout): () => void {
    const ignore = scout.config.ignoreUrlPatterns ?? [];
    const firstParty = scout.config.firstPartyHosts ?? [];
    const ownEndpoint = scout.config.endpoint.replace(/^https?:\/\//, '');
    const shouldSkip = (url: string): boolean => {
        if (!url)
            return true;
        if (url.includes(ownEndpoint))
            return true;
        return ignore.some((re) => re.test(url));
    };
    const isFirstParty = (url: string): boolean => {
        try {
            const host = new URL(url).host;
            return firstParty.some((h) => host === h || host.endsWith(`.${h}`));
        }
        catch {
            return false;
        }
    };
    const g: any = globalThis as any;
    const originalFetch = g.fetch;
    if (typeof originalFetch !== 'function')
        return () => { };
    g.fetch = async (input: any, init?: any) => {
        const url = typeof input === 'string' ? input : (input?.url ?? '');
        const method = (init?.method ?? input?.method ?? 'GET').toUpperCase();
        if (shouldSkip(url))
            return originalFetch(input, init);
        const start = Date.now();
        const headers = new Headers(init?.headers ?? input?.headers ?? {});
        if (isFirstParty(url)) {
            headers.set('traceparent', makeTraceparent());
        }
        try {
            const response = await originalFetch(input, { ...init, headers });
            const duration = Date.now() - start;
            const length = Number(response.headers.get('content-length') ?? 0);
            scout.emitSpan(SPAN.HTTP_REQUEST, {
                [ATTR.HTTP_METHOD]: method,
                [ATTR.HTTP_URL]: url,
                [ATTR.HTTP_STATUS_CODE]: response.status,
                [ATTR.HTTP_RESPONSE_CONTENT_LENGTH]: length,
                [ATTR.HTTP_DURATION_MS]: duration,
                ...scout.commonAttributes(),
            }, { status: response.status >= 400 ? SpanStatusCode.ERROR : undefined });
            scout.addBreadcrumb(BREADCRUMB_TYPE.HTTP, `${method} ${url} → ${response.status}`);
            return response;
        }
        catch (error) {
            const duration = Date.now() - start;
            scout.emitSpan(SPAN.HTTP_REQUEST, {
                [ATTR.HTTP_METHOD]: method,
                [ATTR.HTTP_URL]: url,
                [ATTR.HTTP_DURATION_MS]: duration,
                [ATTR.HTTP_ERROR]: error instanceof Error ? error.message : String(error),
                ...scout.commonAttributes(),
            }, { status: SpanStatusCode.ERROR });
            throw error;
        }
    };
    return () => {
        g.fetch = originalFetch;
    };
}
function makeTraceparent(): string {
    const rand = (n: number) => {
        let s = '';
        for (let i = 0; i < n; i++)
            s += Math.floor(Math.random() * 16).toString(16);
        return s;
    };
    return `00-${rand(32)}-${rand(16)}-01`;
}
