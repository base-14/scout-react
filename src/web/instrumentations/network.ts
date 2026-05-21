import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { SpanStatusCode } from '@opentelemetry/api';
import { claimResourceEntry } from '../performance-buffer';
import { resourceTimingAttributes } from './resource-timing';
import { lookupProvider } from '../../core/provider-lookup';
import { parseGraphQLRequest, parseGraphQLResponse } from '../../core/graphql-parser';
import type { Attributes } from '../../core/types';
import { uuidv4 } from '../../core/uuid';
export function installNetworkTracker(scout: Scout): () => void {
  const ignore = scout.config.ignoreUrlPatterns ?? [];
  const firstPartyMatchers = compileFirstPartyMatchers(
    scout.config.firstPartyHosts ?? [],
  );
  const ownEndpoint = stripScheme(scout.config.endpoint);
  const shouldSkip = (url: string): boolean => {
    if (!url) return true;
    if (url.includes(ownEndpoint)) return true;
    for (const re of ignore) {
      if (re.test(url)) return true;
    }
    return false;
  };
  const isFirstParty = (url: string): boolean => {
    try {
      const u = new URL(
        url,
        typeof location !== 'undefined' ? location.href : 'http://localhost',
      );
      return firstPartyMatchers.some((m) => m(u.host));
    } catch {
      return false;
    }
  };
  const restore: Array<() => void> = [];
  if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method ?? (input as Request).method ?? 'GET').toUpperCase();
      if (shouldSkip(url)) {
        return originalFetch(input as any, init);
      }
      const start = performance.now();
      const headers = new Headers(init?.headers ?? (input as Request).headers ?? {});
      const providerAttrs = providerAttrsFor(url);
      const graphqlAttrs = graphqlReqAttrsFor(init?.body);
      const httpSpan = scout.startChildSpan(SPAN.HTTP_REQUEST, {
        [ATTR.HTTP_RESOURCE_ID]: uuidv4(),
        [ATTR.HTTP_METHOD]: method,
        [ATTR.HTTP_URL]: url,
        ...providerAttrs,
        ...graphqlAttrs,
        ...scout.commonAttributes(),
      });
      if (httpSpan && isFirstParty(url)) {
        const ctx = httpSpan.spanContext();
        headers.set('traceparent', `00-${ctx.traceId}-${ctx.spanId}-01`);
      }
      try {
        const response = await originalFetch(input as any, { ...init, headers });
        const duration = performance.now() - start;
        const length = Number(response.headers.get('content-length') ?? 0);
        if (httpSpan) {
          httpSpan.setAttributes({
            [ATTR.HTTP_STATUS_CODE]: response.status,
            [ATTR.HTTP_RESPONSE_CONTENT_LENGTH]: length,
            [ATTR.HTTP_DURATION_MS]: duration,
          });
          try {
            const entry = claimResourceEntry(url, start);
            if (entry) httpSpan.setAttributes(resourceTimingAttributes(entry) as never);
          } catch {}
          if (response.status >= 400) {
            httpSpan.setStatus({ code: SpanStatusCode.ERROR });
          }
          if (
            graphqlAttrs[ATTR.GRAPHQL_OPERATION_TYPE] != null ||
            String(response.headers.get('content-type') ?? '').includes(
              'application/json',
            )
          ) {
            try {
              const clone = response.clone();
              void clone.text().then((txt) => {
                const gql = parseGraphQLResponse(txt);
                if (gql) {
                  httpSpan.setAttributes({
                    [ATTR.GRAPHQL_ERROR_COUNT]: gql.errorCount,
                    [ATTR.GRAPHQL_ERRORS_JSON]:
                      gql.errors.length > 0
                        ? JSON.stringify(gql.errors).slice(0, 4000)
                        : '',
                  });
                }
              });
            } catch {}
          }
          httpSpan.end();
        }
        scout.addBreadcrumb(
          BREADCRUMB_TYPE.HTTP,
          `${method} ${url} → ${response.status}`,
        );
        return response;
      } catch (error) {
        const duration = performance.now() - start;
        if (httpSpan) {
          httpSpan.setAttributes({
            [ATTR.HTTP_DURATION_MS]: duration,
            [ATTR.HTTP_ERROR]: error instanceof Error ? error.message : String(error),
          });
          httpSpan.setStatus({ code: SpanStatusCode.ERROR });
          httpSpan.end();
        }
        scout.addBreadcrumb(BREADCRUMB_TYPE.HTTP, `${method} ${url} → error`);
        throw error;
      }
    };
    restore.push(() => {
      globalThis.fetch = originalFetch;
    });
  }
  if (typeof XMLHttpRequest !== 'undefined') {
    const Original = XMLHttpRequest;
    const proto = Original.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;
    const origSetHeader = proto.setRequestHeader;
    proto.open = function (this: any, method: string, url: string | URL, ...rest: any[]) {
      this.__scout = { method: method.toUpperCase(), url: String(url) };
      return (origOpen as any).call(this, method, url, ...rest);
    };
    proto.setRequestHeader = function (this: any, name: string, value: string) {
      return origSetHeader.call(this, name, value);
    };
    proto.send = function (this: any, body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = this.__scout;
      if (!meta || shouldSkip(meta.url)) {
        return origSend.call(this, body as any);
      }
      const start = performance.now();
      if (isFirstParty(meta.url)) {
        try {
          origSetHeader.call(this, 'traceparent', makeTraceparent());
        } catch {}
      }
      const finalize = (statusOverride?: number, errorMsg?: string) => {
        const duration = performance.now() - start;
        const status = statusOverride ?? this.status;
        const phaseAttrs = (() => {
          try {
            const entry = claimResourceEntry(meta.url, start);
            return entry ? resourceTimingAttributes(entry) : {};
          } catch {
            return {};
          }
        })();
        scout.emitSpan(
          SPAN.HTTP_REQUEST,
          {
            [ATTR.HTTP_RESOURCE_ID]: uuidv4(),
            [ATTR.HTTP_METHOD]: meta.method,
            [ATTR.HTTP_URL]: meta.url,
            [ATTR.HTTP_STATUS_CODE]: status,
            [ATTR.HTTP_DURATION_MS]: duration,
            ...(errorMsg ? { [ATTR.HTTP_ERROR]: errorMsg } : {}),
            ...phaseAttrs,
            ...scout.commonAttributes(),
          },
          { status: errorMsg || status >= 400 ? SpanStatusCode.ERROR : undefined },
        );
        scout.addBreadcrumb(
          BREADCRUMB_TYPE.HTTP,
          `${meta.method} ${meta.url} → ${errorMsg ?? status}`,
        );
      };
      this.addEventListener('loadend', () => finalize());
      this.addEventListener('error', () => finalize(0, 'network error'));
      this.addEventListener('timeout', () => finalize(0, 'timeout'));
      this.addEventListener('abort', () => finalize(0, 'aborted'));
      return origSend.call(this, body as any);
    };
    restore.push(() => {
      proto.open = origOpen;
      proto.send = origSend;
      proto.setRequestHeader = origSetHeader;
    });
  }
  return () => {
    for (const r of restore) r();
  };
}
type HostMatcher = (host: string) => boolean;
function compileFirstPartyMatchers(entries: Array<string | RegExp>): HostMatcher[] {
  return entries
    .map<HostMatcher | null>((entry) => {
      if (entry instanceof RegExp) {
        return (host) => entry.test(host);
      }
      if (entry.startsWith('*.')) {
        const suffix = entry.slice(2).toLowerCase();
        return (host) => {
          const h = host.toLowerCase();
          return h === suffix || h.endsWith(`.${suffix}`);
        };
      }
      const target = normalizeHost(entry).toLowerCase();
      return (host) => host.toLowerCase() === target;
    })
    .filter((m): m is HostMatcher => m !== null);
}
function normalizeHost(h: string): string {
  try {
    return new URL(h.startsWith('http') ? h : `https://${h}`).host;
  } catch {
    return h;
  }
}
function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
function makeTraceparent(): string {
  return `00-${randHex(32)}-${randHex(16)}-01`;
}
function providerAttrsFor(url: string): Attributes {
  const p = lookupProvider(url);
  if (!p) return {};
  return {
    [ATTR.HTTP_PROVIDER_DOMAIN]: p.domain,
    [ATTR.HTTP_PROVIDER_NAME]: p.name,
    [ATTR.HTTP_PROVIDER_TYPE]: p.type,
  };
}
function graphqlReqAttrsFor(body: unknown): Attributes {
  const gql = parseGraphQLRequest(body);
  if (!gql) return {};
  const out: Attributes = {
    [ATTR.GRAPHQL_OPERATION_TYPE]: gql.operationType,
  };
  if (gql.operationName) out[ATTR.GRAPHQL_OPERATION_NAME] = gql.operationName;
  if (gql.variables != null) {
    try {
      out[ATTR.GRAPHQL_VARIABLES] = JSON.stringify(gql.variables).slice(0, 4000);
    } catch {}
  }
  return out;
}
function randHex(len: number): string {
  const bytes = new Uint8Array(len / 2);
  const g: any = globalThis;
  if (g.crypto?.getRandomValues) g.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
