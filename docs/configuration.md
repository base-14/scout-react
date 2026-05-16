# Configuration

Every option you can pass to `Scout.initialize()`. Required fields are flagged with **(required)**; everything else has a sensible default and is opt-in.

```ts
await Scout.initialize({
  serviceName: 'my-app',        // (required)
  endpoint: 'https://...',      // (required)
  // ...
});
```

---

## Identity

| Field | Type | Default | Description |
|---|---|---|---|
| `serviceName` | `string` | **(required)** | Logical app identifier. Used as `service.name` on every span/metric/log. |
| `endpoint` | `string` | **(required)** | OTLP-HTTP collector URL. Suffixes `/v1/traces`, `/v1/metrics`, `/v1/logs` are appended automatically. |
| `serviceVersion` | `string` | `'1.0.0'` | Maps to `service.version`. Set to your app's build version for change-tracking. |
| `environment` | `string` | `undefined` | Free-form environment tag (`'production'`, `'staging'`, etc.). Set as `environment` resource attribute. |
| `applicationId` | `string` | `undefined` | Your backend's application identifier. Maps to `application.id`. |
| `buildId` | `string` | `undefined` | Build-time hash for this exact binary. Maps to `app.build_id`. |
| `secure` | `boolean` | `true` | When `endpoint` has no scheme, prefix `https://` (true) or `http://` (false). |

## Transport

| Field | Type | Default | Description |
|---|---|---|---|
| `headers` | `Record<string, string>` | `{}` | Extra HTTP headers on every export. Use for auth tokens, tenant IDs, etc. |
| `firstPartyHosts` | `Array<string \| RegExp>` | `[]` | Hosts considered "your" backend. Outbound `fetch` calls to these hosts get a `traceparent` header so backend traces correlate. |
| `ignoreUrlPatterns` | `RegExp[]` | `[]` | URLs matching any of these are not auto-instrumented (no `http.request` span, no breadcrumb). |

## Export pacing

How telemetry is batched and flushed.

### Traces

| Field | Type | Default | Description |
|---|---|---|---|
| `traceExportIntervalMs` | `number` | `5000` | Trace buffer flush interval. Shorter = lower visibility delay; higher = fewer HTTP requests. |
| `traceMaxQueueSize` | `number` | `2048` | Maximum spans buffered. When the queue is full (collector offline, slow export), the oldest spans are dropped. |
| `traceMaxExportBatchSize` | `number` | `512` | Maximum spans per single HTTP POST. Larger batches = better compression, slightly higher tail latency. |

### Logs

| Field | Type | Default | Description |
|---|---|---|---|
| `logExportScheduledDelayMs` | `number` | `5000` | Log buffer flush interval. |
| `logMaxQueueSize` | `number` | `2048` | Max log records buffered before drop. |
| `logMaxExportBatchSize` | `number` | `512` | Max log records per POST. |

### Metrics

| Field | Type | Default | Description |
|---|---|---|---|
| `metricExportIntervalMs` | `number` | `30000` | Metric reader's periodic export interval. |

### Shared HTTP

| Field | Type | Default | Description |
|---|---|---|---|
| `exportTimeoutMs` | `number` | `30000` | Per-export HTTP timeout. Applied to traces, metrics, logs. |

## Retry policy

What happens when an export fails. The SDK wraps every OTLP exporter with retry-on-failure using exponential backoff with **full jitter** (a uniform random delay between 0 and the computed backoff). This avoids retry storms when many clients all reconnect after an outage.

| Field | Type | Default | Description |
|---|---|---|---|
| `exportRetry.maxRetries` | `number` | `3` | Retries per batch. Set `0` to disable retry (at-most-once delivery). |
| `exportRetry.initialDelayMs` | `number` | `1000` | First retry delay. Doubles every attempt up to `maxDelayMs`. |
| `exportRetry.maxDelayMs` | `number` | `30000` | Cap on the exponential backoff. |

**What's retryable**: network errors (fetch reject / abort / timeout / ECONNREFUSED / ENOTFOUND), HTTP `408`, `429`, and any `5xx` status. Everything else (`400`, `401`, `403`, etc.) is treated as permanent and surfaces immediately so the batch is dropped without burning retries.

## Offline buffer

When in-memory retry is exhausted on a retryable failure, the batch is **persisted to disk** instead of being dropped. Buffered batches are replayed on next `Scout.initialize()`, on app foreground (RN), and on `visibilitychange → visible` / `online` events (web).

| Field | Type | Default | Description |
|---|---|---|---|
| `offlineBuffer.enabled` | `boolean` | `true` | Master toggle. Set `false` for strict at-most-once delivery. |
| `offlineBuffer.maxItems.traces` | `number` | `5000` | FIFO cap on persisted span items. Oldest evicted first when exceeded. |
| `offlineBuffer.maxItems.metrics` | `number` | `2000` | Same, for metric data points. |
| `offlineBuffer.maxItems.logs` | `number` | `5000` | Same, for log records. |

**Storage backend**: AsyncStorage on RN, localStorage on web. One key per signal type. Atomic per-batch eviction — if the FIFO cap would be exceeded by a new batch, the oldest batches are shifted out until the cap is satisfied.

**Replay path**: persisted payloads are sent as raw OTLP JSON via `fetch` (bypassing the in-memory exporter pipeline). The user's configured `headers` are reused so auth still works. Drain stops on the first failure to preserve order; later attempts pick up where they left off.

**What still goes wrong**: storage caps mean very long outages still cause loss (oldest data evicted first — your most recent data survives). Storage backend quota errors are caught and the batch is dropped silently. If the app crashes mid-write, that batch is lost.

### Sizing guide

Measured from a real Scout RN session: an OTLP-serialized span averages **~5 KB** (range 3–6 KB) because every span carries ~50 attributes (battery, network, a11y, device, session, enduser). Heavier than a typical backend span (~1 KB) which doesn't carry RUM context. Use this to size `maxItems`:

| Profile | `traces` | `metrics` | `logs` | Worst-case disk |
|---|---|---|---|---|
| **Default** | `5000` | `2000` | `5000` | ~25–35 MB |
| Low-end Android, conservative | `2000` | `1000` | `2000` | ~10–15 MB |
| High-traffic app, long-outage tolerant | `10000` | `5000` | `10000` | ~50–70 MB |
| Web (localStorage 5–10 MB quota) | `3000` | `1500` | `3000` | ~15–20 MB |

If you see `QuotaExceededError` in browser telemetry, drop the web caps. On Android, AsyncStorage spills large blobs to SQLite — writes start to slow noticeably above ~5 MB per key, so prefer many small batches (which is what `traceMaxExportBatchSize` already controls) over fewer huge ones.

## Sessions

| Field | Type | Default | Description |
|---|---|---|---|
| `sessionTimeoutMinutes` | `number` | `30` | Inactivity timeout before a new `session.id` is minted. |
| `sessionSampleRate` | `number (0-100)` | `100` | Percent of sessions sampled. Below `100`, full sessions are dropped (not individual events) so you keep coherent session traces. |
| `maxOfflineStorageMb` | `number` | `5` | Soft cap on offline persistence size. Currently advisory (no on-disk persistence yet). |

## Auto-instrumentation toggles

Every auto-instrumentation can be turned off independently. All default to `true`.

| Field | Default | What it captures |
|---|---|---|
| `enableAutoTapTracking` | `true` | Web: `click` on every element. RN: `onPress` on Pressable/Touchable* (via babel plugin). Emits `user_interaction` spans. |
| `enableErrorTracking` | `true` | `window.onerror`, `unhandledrejection`, native crashes via KSCrash + NDK signal handler + MetricKit + ApplicationExitInfo. Emits `error`, `app_crash`, `native_crash` spans. |
| `enableLifecycleTracking` | `true` | App `foreground`/`background`/`paused`/`resumed`. Emits `app_paused` / `app_resumed` spans + `view.in_foreground_periods_json` on screen_view. |
| `enableStartupTracking` | `true` | Cold/warm/hot start timing. Emits `app_startup` span. |
| `enableConnectivityTracking` | `true` | Network type changes (`wifi` → `cellular`), connection quality. |
| `enablePerformanceMetrics` | `true` | Memory and CPU samples. |
| `enableLongTaskDetection` | `true` | JS long tasks > `longTaskThresholdMs`. Emits `long_task` span. |
| `enableAnrDetection` | `true` | RN App-Not-Responding via timer drift. Emits `anr` span. |
| `enableFrameMetrics` | `true` | RN frame rate, slow frames, frozen frames. Emits `react_native.frame.*` metrics + `frozen_frame` spans. |
| `enableMemoryMetrics` | `true` | RN process memory sampling. |
| `enableWebVitals` | `true` | Web: LCP, INP, CLS, FCP, TTFB. Emits `web_vital` spans. |
| `enableBatteryTracking` | `true` | RN: battery level + charging state on every span. |
| `enableNetworkTracking` | `true` | Wraps `fetch` / `XMLHttpRequest`. Emits `http.request` spans + provider classification + GraphQL parse. |
| `enableLogging` | `true` | Allows `Scout.log*()` calls to emit OTLP logs. |
| `captureConsole` / `capturePrintStatements` | `false` | Mirrors `console.log/info/warn/error/debug` to OTLP logs. Original `console` output preserved. |

## Thresholds

| Field | Type | Default | Description |
|---|---|---|---|
| `longTaskThresholdMs` | `number` | `100` | JS task duration that qualifies as a `long_task` span. Min `20`. |
| `anrThresholdMs` | `number` | `5000` | Timer-drift threshold that triggers an `anr` span. Min `1000`. |

## Resource attributes

| Field | Type | Default | Description |
|---|---|---|---|
| `resourceAttributes` | `Record<string, string \| number \| boolean>` | `{}` | Extra resource attributes merged into every signal. Use for `deployment.region`, `team`, etc. |

## Filtering

| Field | Type | Default | Description |
|---|---|---|---|
| `beforeSend` | `(event) => event \| null` | `undefined` | Runs on every span/metric/log before export. Return `null` to drop the event entirely. Mutate the passed object to redact PII (`delete event['enduser.email']`). |

## Debug

| Field | Type | Default | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Print SDK internals to the host console (Metro / browser devtools / Xcode). Useful while integrating. Don't ship `true` to production. |

---

## Full example

```ts
await Scout.initialize({
  // Identity
  serviceName: 'platform-design-mobile',
  serviceVersion: '0.1.0',
  environment: 'production',
  endpoint: 'https://otel.example.com',
  applicationId: 'pd-mobile',
  buildId: 'a3f4e2c',

  // Transport
  headers: { 'x-api-key': 'redacted' },
  firstPartyHosts: ['api.example.com', /\.internal\.example\.com$/],
  ignoreUrlPatterns: [/\/health$/, /\/_next\//],

  // Pacing — chatty app, tight intervals
  traceExportIntervalMs: 2000,
  traceMaxQueueSize: 4096,
  traceMaxExportBatchSize: 256,
  metricExportIntervalMs: 10_000,
  logExportScheduledDelayMs: 2000,
  exportTimeoutMs: 10_000,

  // Retry — flaky network, more attempts at lower latency
  exportRetry: {
    maxRetries: 5,
    initialDelayMs: 250,
    maxDelayMs: 8000,
  },

  // Sessions
  sessionTimeoutMinutes: 15,
  sessionSampleRate: 100,

  // Resource
  resourceAttributes: {
    'deployment.region': 'us-east-1',
    team: 'mobile',
  },

  // Filtering — drop health checks, scrub email
  beforeSend: (event) => {
    if (String(event['http.url'] ?? '').includes('/health')) return null;
    delete event['enduser.email'];
    return event;
  },

  // Auto-instrumentation off-switches (everything else stays default = on)
  enableWebVitals: false,
  captureConsole: true,
  longTaskThresholdMs: 150,
});
```
