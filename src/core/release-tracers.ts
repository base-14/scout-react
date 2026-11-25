import type { Tracer } from '@opentelemetry/api';
import { BasicTracerProvider, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes, type Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { ATTR } from './attributes';
import { SCOPE_NAME, SCOPE_VERSION } from './scope';

/** An app release, as the SDK labels it: `service.version` is `version+build`. */
export interface Release {
  version: string;
  build: string;
}

/**
 * A tracer whose resource names `release` instead of the running one, or
 * null when `release` is the running one.
 */
export type ReleaseTracers = (release: Release) => Tracer | null;

/**
 * OpenTelemetry fixes the resource per provider, so a span labelled with
 * another release needs its own provider. Each one shares `spanProcessors`
 * with the main provider: same batch queue, exporter, kill-switch gate,
 * retries and offline buffer. Only the resource differs. One provider per
 * release, created on first use.
 */
export function createReleaseTracers(
  resource: Resource,
  spanProcessors: SpanProcessor[],
): ReleaseTracers {
  const current = resource.attributes[ATTR_SERVICE_VERSION];
  const tracers = new Map<string, Tracer>();
  return ({ version, build }) => {
    const serviceVersion = `${version}+${build}`;
    if (serviceVersion === current) return null;
    let tracer = tracers.get(serviceVersion);
    if (!tracer) {
      const provider = new BasicTracerProvider({
        resource: resource.merge(
          resourceFromAttributes({
            [ATTR_SERVICE_VERSION]: serviceVersion,
            [ATTR.APP_VERSION]: version,
            [ATTR.APP_BUILD]: build,
          }),
        ),
        spanProcessors,
      });
      tracer = provider.getTracer(SCOPE_NAME, SCOPE_VERSION);
      tracers.set(serviceVersion, tracer);
    }
    return tracer;
  };
}
