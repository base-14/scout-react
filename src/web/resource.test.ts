// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SCOPE_VERSION } from '../core/scope';
import { ATTR } from '../core/attributes';

describe('web resource attributes', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    );
  });
  afterEach(async () => {
    const { Scout } = await import('./index');
    await Scout.shutdown();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function initialize(config: Record<string, unknown> = {}) {
    const { Scout } = await import('./index');
    await Scout.initialize({
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      ...config,
    } as never);
    return (Scout as unknown as { _providers: Record<string, ProviderInternals> })
      ._providers;
  }

  // The providers keep their Resource private, and the three SDKs disagree on
  // where: the tracer holds `_resource`, the meter and logger nest it under
  // `_sharedState`. Reading it is the only way to assert what actually ships.
  interface ProviderInternals {
    _resource?: { attributes: Record<string, unknown> };
    _sharedState?: { resource: { attributes: Record<string, unknown> } };
  }

  function attrsOf(provider: ProviderInternals): Record<string, unknown> {
    const resource = provider._resource ?? provider._sharedState?.resource;
    if (!resource) throw new Error('provider exposes no resource');
    return resource.attributes;
  }

  it('stamps scout.react.version on traces, metrics and logs', async () => {
    const providers = await initialize();
    for (const key of ['traceProvider', 'meterProvider', 'loggerProvider']) {
      expect(attrsOf(providers[key]!)[ATTR.SCOUT_REACT_VERSION]).toBe(SCOPE_VERSION);
    }
  });

  it('cannot be shadowed by integrator resourceAttributes', async () => {
    // The backend attributes every signal to an SDK build with this key; an
    // app overriding it would misreport which SDK produced the telemetry.
    const providers = await initialize({
      resourceAttributes: { [ATTR.SCOUT_REACT_VERSION]: '9.9.9', team: 'checkout' },
    });
    const attrs = attrsOf(providers.traceProvider!);
    expect(attrs[ATTR.SCOUT_REACT_VERSION]).toBe(SCOPE_VERSION);
    expect(attrs.team).toBe('checkout');
  });
});
