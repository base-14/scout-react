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
 *
 * The running release is compared by app version and build separately. When
 * the running resource has no build, nothing is relabelled: a crash with a
 * build can't be told apart from the running release reliably.
 *
 * Providers use OpenTelemetry's default sampler, ID generator and span
 * limits, like the main provider in src/native/index.ts. Keep them in sync
 * if that one ever gets options of its own.
 */
export function createReleaseTracers(
  resource: Resource,
  spanProcessors: SpanProcessor[],
): ReleaseTracers {
  const runningVersion = resource.attributes[ATTR.APP_VERSION];
  const runningBuild = resource.attributes[ATTR.APP_BUILD];
  const tracers = new Map<string, Tracer>();
  return (release) => {
    if (typeof runningVersion !== 'string' || typeof runningBuild !== 'string')
      return null;
    const version = release.version.trim();
    const build = release.build.trim();
    if (!version || !build) return null;
    if (version === runningVersion.trim() && build === runningBuild.trim()) return null;
    const serviceVersion = `${version}+${build}`;
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
