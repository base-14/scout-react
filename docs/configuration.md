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
| `firstPartyHosts` | `Array<string \| RegExp>` | `[]` | Hosts considered "your" backend. Outbound `fetch` and `XMLHttpRequest` calls to these hosts get a `traceparent` header so backend traces correlate. |
| `ignoreUrlPatterns` | `RegExp[]` | `[]` | URLs matching any of these are not auto-instrumented (no `http.request` span, no breadcrumb). |

### Rotating an auth token

`headers` is read on every export rather than snapshotted at init, so an
expiring bearer token is refreshed by mutating the object you passed in:

```ts
const headers = { Authorization: `Bearer ${token}` };
await Scout.initialize({ serviceName: 'app', endpoint, headers });

// later, before the token expires — no re-initialize, no dropped batches
headers.Authorization = `Bearer ${await mintToken()}`;
```

Replacing the object (`headers = {...}`) does **not** work; the exporters hold
the original reference.

## Export pacing

How telemetry is batched and flushed.

### Unified knobs (preferred)

Set the cadence once for all three signals.

| Field | Type | Default | Description |
|---|---|---|---|
| `exportIntervalSeconds` | `number` | `30` | Flush interval for traces, logs **and** metrics. Minimum `1`. |
| `metricExportIntervalSeconds` | `number` | inherits | Metrics-only override. |
| `maxExportBatchSize` | `number` | `512` | Max items per HTTP POST, applied to traces and logs. |
| `maxQueueSize` | `number` | `2048` | Max items buffered before the oldest are dropped, applied to traces and logs. |

### Per-signal overrides

These still exist for backwards compatibility and **win over the unified knobs** when set explicitly. Left unset, they inherit from the table above.

| Field | Type | Default | Description |
|---|---|---|---|
| `traceExportIntervalMs` | `number` | `exportIntervalSeconds` | Trace buffer flush interval. |
| `traceMaxQueueSize` | `number` | `maxQueueSize` | Maximum spans buffered. When the queue is full (collector offline, slow export), the oldest spans are dropped. |
| `traceMaxExportBatchSize` | `number` | `maxExportBatchSize` | Maximum spans per single HTTP POST. Larger batches = better compression, slightly higher tail latency. |
| `logExportScheduledDelayMs` | `number` | `exportIntervalSeconds` | Log buffer flush interval. |
| `logMaxQueueSize` | `number` | `maxQueueSize` | Max log records buffered before drop. |
| `logMaxExportBatchSize` | `number` | `maxExportBatchSize` | Max log records per POST. |
| `metricExportIntervalMs` | `number` | `metricExportIntervalSeconds` | Metric reader's periodic export interval. |

```ts
// traces every 5s, logs and metrics every 10s
Scout.initialize({
  serviceName, endpoint,
  exportIntervalSeconds: 10,
  traceExportIntervalMs: 5000,
});
```

### Vitals sampling

| Field | Type | Default | Description |
|---|---|---|---|
| `vitalsCollectionIntervalSeconds` | `number` | `60` | Sampling cadence for memory, CPU, frame and battery vitals. Minimum `1`. Only in effect for the vitals you have enabled — all of them are opt-in. |

### Shared HTTP

| Field | Type | Default | Description |
|---|---|---|---|
| `exportTimeoutMs` | `number` | `30000` | Per-export HTTP timeout. Applied to traces, metrics, logs. |

## Retry policy

**Delivery is at-most-once by default.** Retrying an ambiguous failure — a timeout whose request the collector may already have ingested — re-delivers spans with identical span IDs. For RUM data, no duplicates is worth more than lossless delivery, so `maxRetries` defaults to `0` and one `export()` puts exactly one request on the wire.

Opting in (`maxRetries > 0`) wraps every OTLP exporter with retry-on-failure using exponential backoff with **full jitter** (a uniform random delay between 0 and the computed backoff). This avoids retry storms when many clients all reconnect after an outage. Retry lives in exactly one layer: the SDK's own exporters issue a single request per attempt, so the total request count per batch is exactly `maxRetries + 1`.

| Field | Type | Default | Description |
|---|---|---|---|
| `exportRetry.maxRetries` | `number` | `0` | Retries per batch. `0` = at-most-once delivery. Set `3` for the pre-0.1.12 behaviour. |
| `exportRetry.initialDelayMs` | `number` | `1000` | First retry delay. Doubles every attempt up to `maxDelayMs`. |
| `exportRetry.maxDelayMs` | `number` | `30000` | Cap on the exponential backoff. |

**What's retryable**: network errors (fetch reject / abort / timeout / ECONNREFUSED / ENOTFOUND), HTTP `408`, `429`, and any `5xx` status. Everything else (`400`, `401`, `403`, etc.) is treated as permanent and surfaces immediately so the batch is dropped without burning retries.

## Offline buffer

**Off by default** since 0.1.12 — replaying a persisted batch is another way to deliver the same span twice. When enabled, a batch that fails with a retryable error (after any configured retries) is **persisted to disk** instead of being dropped, and replayed on next `Scout.initialize()`, on app foreground (RN), and on `visibilitychange → visible` / `online` events (web).

Buffering works independently of `exportRetry.maxRetries`: with the default `0`, a failed batch goes straight to disk.

```ts
Scout.initialize({
  serviceName, endpoint,
  offlineBuffer: { enabled: true, maxItems: { traces: 5000, metrics: 2000, logs: 5000 } },
});
```

| Field | Type | Default | Description |
|---|---|---|---|
| `offlineBuffer.enabled` | `boolean` | `false` | Master toggle. `false` keeps delivery strictly at-most-once. |
| `offlineBuffer.maxItems.traces` | `number` | `0` | FIFO cap on persisted span items. Oldest evicted first when exceeded. |
| `offlineBuffer.maxItems.metrics` | `number` | `0` | Same, for metric data points. |
| `offlineBuffer.maxItems.logs` | `number` | `0` | Same, for log records. |
| `maxOfflineStorageMb` | `number` | `5` | Coarse total-disk cap for the offline buffer. Runs alongside the per-signal `offlineBuffer.maxItems.*` caps above — whichever limit is reached first wins. |

**Storage backend**: AsyncStorage on RN, localStorage on web. One key per signal type. Atomic per-batch eviction — if the FIFO cap would be exceeded by a new batch, the oldest batches are shifted out until the cap is satisfied.

**Replay path**: persisted payloads are sent as raw OTLP JSON via `fetch` (bypassing the in-memory exporter pipeline). The user's configured `headers` are reused so auth still works. Drain stops on the first failure to preserve order; later attempts pick up where they left off.

**What still goes wrong**: storage caps mean very long outages still cause loss (oldest data evicted first — your most recent data survives). Storage backend quota errors are caught and the batch is dropped silently. If the app crashes mid-write, that batch is lost.

### Sizing guide

Measured from a real Scout RN session: an OTLP-serialized span averages **~5 KB** (range 3–6 KB) because every span carries ~50 attributes (battery, network, a11y, device, session, enduser). Heavier than a typical backend span (~1 KB) which doesn't carry RUM context. Use this to size `maxItems`:

| Profile | `traces` | `metrics` | `logs` | Worst-case disk |
|---|---|---|---|---|
| **Pre-0.1.12 default** | `5000` | `2000` | `5000` | ~25–35 MB |
| Low-end Android, conservative | `2000` | `1000` | `2000` | ~10–15 MB |
| High-traffic app, long-outage tolerant | `10000` | `5000` | `10000` | ~50–70 MB |
| Web (localStorage 5–10 MB quota) | `3000` | `1500` | `3000` | ~15–20 MB |

If you see `QuotaExceededError` in browser telemetry, drop the web caps. On Android, AsyncStorage spills large blobs to SQLite — writes start to slow noticeably above ~5 MB per key, so prefer many small batches (which is what `traceMaxExportBatchSize` already controls) over fewer huge ones.

## Sessions

| Field | Type | Default | Description |
|---|---|---|---|
| `sessionTimeoutMinutes` | `number` | `30` | Inactivity timeout before a new `session.id` is minted. |
| `sessionSampleRate` | `number (0-100)` | `1` | Percent of sessions sampled. Below `100`, full sessions are dropped (not individual events) so you keep coherent session traces. Errors bypass this gate by default — see `alwaysCaptureErrors`. |
| `alwaysCaptureErrors` | `boolean` | `true` | When `true`, error- and crash-class spans (`error`, `native_crash`, `app_crash`, `anr`) and `ERROR`-severity logs bypass `sessionSampleRate` and are always exported. Set to `false` to subject errors to the same sampling decision as other telemetry. |

## Auto-instrumentation toggles

Every auto-instrumentation can be turned off independently. All default to `true` except the periodic vitals metrics (`enableFrameMetrics`, `enableMemoryMetrics`, `enableCpuMetrics`) and console capture, which are opt-in.

| Field | Default | What it captures |
|---|---|---|
| `enableAutoTapTracking` | `true` | Web: the DOM events listed under `interactionEvents`. RN: `onPress` on Pressable/Touchable* (via babel plugin). Emits `user_interaction` spans. |
| `interactionEvents` | `['click','change','submit','input']` | Web only. Which DOM events auto-tap tracking listens to; the value lands on the span as `user_interaction.type`. See below. |
| `enableErrorTracking` | `true` | `window.onerror`, `unhandledrejection`, native crashes via KSCrash + NDK signal handler + MetricKit + ApplicationExitInfo. Emits `error`, `app_crash`, `native_crash` spans. |
| `enableLifecycleTracking` | `true` | App `foreground`/`background`/`paused`/`resumed`. Emits `app_paused` / `app_resumed` spans + `view.in_foreground_periods_json` on screen_view. |
| `enableStartupTracking` | `true` | Cold/warm/hot start timing. Emits `app_startup` span. |
| `enableConnectivityTracking` | `true` | Network type changes (`wifi` → `cellular`), connection quality. |
| `enablePerformanceMetrics` | `true` | Memory and CPU samples. |
| `enableLongTaskDetection` | `true` | JS long tasks > `longTaskThresholdMs`. Emits `long_task` span. |
| `enableAnrDetection` | `true` | RN App-Not-Responding via timer drift. Emits `anr` span. |
| `enableFrameMetrics` | **`false`** | RN frame rate, slow frames, frozen frames. Emits `react_native.frame.*` metrics + `frozen_frame` spans. Opt-in: highest-volume signal the SDK produces. |
| `enableMemoryMetrics` | **`false`** | RN/web process memory sampling. Emits `*.memory.*` metrics. Opt-in. |
| `enableCpuMetrics` | **`false`** | RN CPU usage sampling. Emits `react_native.cpu.usage`. Opt-in. |
| `enableWebVitals` | `true` | Web: LCP, INP, CLS, FCP, TTFB. Emits `web_vital` spans. |
| `enableBatteryTracking` | `true` | RN: battery level + charging state on every span. |
| `enableNetworkTracking` | `true` | Wraps `fetch` / `XMLHttpRequest`. Emits `http.request` spans + provider classification + GraphQL parse. |
| `enableLogging` | `true` | Allows `Scout.log*()` calls to emit OTLP logs. |
| `captureConsole` / `capturePrintStatements` | `false` | Mirrors `console.log/info/warn/error/debug` to OTLP logs. Original `console` output preserved. |

### `interactionEvents` (web)

| Value | Fires on | Notes |
|---|---|---|
| `click` | any element | Carries `target.x` / `target.y` and `user_interaction.trigger: pointer`. |
| `change` | `<select>`, checkbox, radio, file, date, time, range | Free-text inputs are excluded — their `change` fires on blur, which reports an edit somewhere the user does not associate with it. Adds `user_interaction.value` for closed value spaces only (selected option label, `checked`/`unchecked`). |
| `submit` | form submission, **and** Enter in a text entry | `user_interaction.trigger` distinguishes `unknown` (form) from `keyboard` (Enter). The Enter case exists because React handlers routinely swallow the real `submit` event. |
| `input` | text entries | Debounced 500 ms after typing stops, so one edit is one span. Moving to another field flushes the previous edit immediately, preserving edit order. Never fires for `password`/`email`/`tel`/`hidden`. |

Narrow the list on chatty UIs — `input` is usually the first to drop. `[]`
disables interaction tracking without touching `enableAutoTapTracking`.

Free text never leaves the page: `user_interaction.value` is only set for
controls with a closed value space, and a sensitive field's description is
reported as `redacted` rather than falling through to nearby text content.

## Thresholds

| Field | Type | Default | Description |
|---|---|---|---|
| `longTaskThresholdMs` | `number` | `100` | JS task duration that qualifies as a `long_task` span. Min `20`. |
| `anrThresholdMs` | `number` | `5000` | Timer-drift threshold that triggers an `anr` span. Min `1000`. |

## Resource attributes

| Field | Type | Default | Description |
|---|---|---|---|
| `resourceAttributes` | `Record<string, string \| number \| boolean>` | `{}` | Extra resource attributes merged into every signal. Use for `deployment.region`, `team`, etc. |

The SDK always stamps **`scout.react.version`** on every span, metric and log, on both web and native. It is pinned to the package version by a CI contract test, and cannot be overridden through `resourceAttributes` — the backend uses it to attribute telemetry to an SDK build, so an app-supplied value would misreport it.

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
  sessionSampleRate: 100,                    // crank up to 100 for full capture during dev
  alwaysCaptureErrors: true,                 // default — errors bypass sampling

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
