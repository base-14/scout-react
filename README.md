# Scout React

Zero-config OpenTelemetry RUM (Real User Monitoring) for React (browser) and React Native. Install the package, call `Scout.initialize()` — that's it.

Auto-captures clicks, navigation, errors, lifecycle, network, performance, web vitals, and device context. Exports over OTLP/HTTP.

```ts
import Scout from '@base-14/scout-react';

await Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'https://otlp.example.com:4318',
});
```

That's all the code you write.

---

## Install

```bash
# from npm (after publish)
npm install @base-14/scout-react

# from git (pin to a tag)
npm install github:base-14/scout-react#v0.1.4
```

Peer deps are installed by the host app on demand (none of them are required for the web entry):

| Use case | Peer deps |
|---|---|
| Web (browser) | `react` (only if you use `/react` helpers) |
| React Native | `react-native`, `@react-native-async-storage/async-storage` |
| RN + navigation tracking | `@react-navigation/native` |
| RN + connectivity tracking | `@react-native-community/netinfo` |
| RN + device model/manufacturer | `react-native-device-info` |
| RN + battery level | `expo-battery` (preferred) or `react-native-device-info` |

---

## Quick start — React (browser)

```ts
import Scout from '@base-14/scout-react';

await Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'https://otlp.example.com:4318',
});
```

That's it. Clicks, route changes, errors, fetch + XHR, lifecycle, web vitals, long tasks, memory, and crashes are all auto-captured. No per-button instrumentation.

Optional React helpers from the `/react` subpath:

```tsx
import { ScoutProvider, useScout, ScoutErrorBoundary, ScoutAction } from '@base-14/scout-react/react';

<ScoutProvider config={{ serviceName: 'my-app', endpoint: '...' }}>
  <ScoutErrorBoundary fallback={(e) => <ErrorPage error={e} />}>
    <App />
  </ScoutErrorBoundary>
</ScoutProvider>;

// Override the tap label for a widget the SDK can't auto-name:
<ScoutAction description="Add to cart">
  <MyFancyButton />
</ScoutAction>
```

---

## Quick start — React Native

Two lines in your entry file. Nothing in your component tree.

```ts
// index.ts
import Scout from '@base-14/scout-react/native';
import App from './App';

Scout.registerRootComponent(App);
```

`registerRootComponent` installs a root-level error + touch boundary via RN's `AppRegistry.setWrapperComponentProvider`. Every tap becomes a `user_interaction` span, every render error becomes an `error` span (with `error.component_stack`), automatically.

Then in your `App.tsx`:

```tsx
import Scout from '@base-14/scout-react/native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';

export default function App() {
  const navRef = useNavigationContainerRef();
  useEffect(() => {
    Scout.initialize({
      serviceName: 'my-app',
      endpoint: 'https://otlp.example.com:4318',
    });
  }, []);
  return (
    <NavigationContainer
      ref={navRef}
      onReady={() => Scout.attachNavigationContainer(navRef)}>
      {/* ... */}
    </NavigationContainer>
  );
}
```

On Android USB devices, the OTLP endpoint runs on your dev machine — point it at `http://localhost:<port>` and run `adb reverse tcp:<port> tcp:<port>` so the phone forwards through USB. iOS simulator shares the host network so `localhost` works directly.

---

## What's captured

### Cross-platform (web + RN)

| Signal | Span / metric | Notes |
|---|---|---|
| Clicks / taps | `user_interaction` | `user_interaction.target`, `target.type` |
| Navigation | `screen_view`, `view_session` | screen_view becomes the root span — all spans on that screen share its trace id |
| Screen load time | `screen_load` | `screen.load_time` in seconds |
| App startup | `app_startup` | cold + warm |
| Lifecycle | `app_paused`, `app_resumed` | Web: visibilitychange; RN: AppState |
| Errors (uncaught) | `error` span + `error.count` metric | `error.handled=false` |
| Errors (manual / boundary) | `error` span | `error.handled=true`, `error.component_stack` if from a React boundary |
| Unhandled rejections | `error` span | Web: window event; RN: HermesInternal |
| Long tasks | `long_task` | Default threshold 100ms |
| Frozen frames | `frozen_frame` | Long task ≥ 700ms (web only) |
| ANR | `anr` | Web: worker watchdog. RN: timer-drift watchdog. |
| HTTP (fetch + XHR) | `http.request` | Method, URL, status, duration, content-length |
| Crash (OOM / force-kill) | `app_crash` on next launch | Persistent session marker (localStorage on web, AsyncStorage on RN) — survives unclean termination |
| Native crash (RN) | `native_crash` on next launch | iOS: **KSCrash 2.5+** (mach exceptions, POSIX signals, C++, NSException, main-thread deadlock) + **MetricKit** (`MXCrashDiagnostic`, `MXHangDiagnostic`) on iOS 14+. Android: uncaught Java/Kotlin (`Thread.setDefaultUncaughtExceptionHandler`) + **NDK signal handler** for native crashes + **ApplicationExitInfo** (API 30+) for OS-recorded process deaths including OOM and ANR. Reports persisted to disk and emitted on next launch with full register / stack / binary-image dumps, prior breadcrumbs, and `crash.type` / `crash.reason` / `crash.stack_trace` |
| Logs | OTLP logs | `Scout.logDebug/Info/Warning/Error` and (opt-in) `console.*` capture |

### Web only

| Signal | Notes |
|---|---|
| Web vitals | LCP, INP, CLS, TTFB, FCP via `web-vitals` (with sub-parts — INP `input_delay_ms`/`processing_duration_ms`/`presentation_delay_ms`, LCP `load_delay_ms`/`load_time_ms`/`render_delay_ms`, CLS layout-shift rects) |
| Memory | `web.memory.usage` gauge (Chromium only) |
| Frame metrics | `web.frame.build_time` histogram via Long Animation Frame API |
| Battery | `device.battery.level`, `device.battery.state` via `navigator.getBattery` (Chromium) |
| Console capture | Opt-in via `captureConsole: true` |

### React Native only

| Signal | Notes |
|---|---|
| Battery | `device.battery.level`, `device.battery.state` via `expo-battery` or `react-native-device-info` |
| Device | model, manufacturer, brand, is_physical, screen dimensions via `react-native-device-info` + `RN.Dimensions` |
| Network connectivity type | via `@react-native-community/netinfo` |
| OS name / version | via `Platform.OS`, `Platform.Version` |
| Memory | `react_native.memory.usage` gauge — polls `react-native-device-info.getUsedMemory()` every 10s |
| Frame metrics | `react_native.frame.build_time` histogram + `react_native.frame.dropped` gauge sampled via `requestAnimationFrame` |
| Long tasks / frozen frames | `long_task` and `frozen_frame` spans derived from the same rAF loop (≥ `longTaskThresholdMs`, ≥ 700ms respectively) |
| Console capture | Opt-in via `captureConsole: true` |

### Resource attributes (shared across all signals)

Attached to every `ResourceSpans` / `ResourceMetrics` / `ResourceLogs` batch:

- `service.name`, `service.version`, `environment`
- `os.name`, `os.version`
- `device.model.name`, `device.manufacturer`, `device.brand`, `device.is_physical`
- `screen.width`, `screen.height`, `screen.pixel_ratio`
- `device.battery.level`, `device.battery.state`
- Anything you pass via `config.resourceAttributes` (e.g. `deployment.region`, `team`)

### InstrumentationScope

Every span, metric, and log emitted by this SDK carries a single
OpenTelemetry InstrumentationScope:

```
name:    base14.scout.react
version: <package.json version>
```

This is enforced by a CI guard test — backends can filter on `scope.name`
to identify all Scout-originated telemetry regardless of which signal or
which auto-instrumentation produced it.

---

## Distributed tracing

Hosts listed in `firstPartyHosts` receive a W3C `traceparent` header on outgoing `fetch` / `XHR`. The header uses the trace + span ID of the SDK's `http.request` span, so your backend's spans parent under the browser's request and the entire flow appears in one trace.

```ts
firstPartyHosts: [
  'api.acme.com',         // exact host
  '*.acme.com',           // matches all subdomains AND the apex
  /^api\d+\.acme\.com$/,  // regex tested against the URL host
],
```

Third-party hosts (Stripe, Google Fonts, Segment, etc.) are still captured as `http.request` spans locally — they just don't get the header.

---

## Identity and breadcrumbs

```ts
Scout.setUser('user-123', { email: 'jane@example.com', plan: 'pro' });
Scout.clearUser();

Scout.addBreadcrumb('checkout', 'added item to cart');
Scout.addBreadcrumb('checkout', 'entered payment details');
// The last 20 breadcrumbs are JSON-serialized onto every `error` and
// `app_crash` span so you can see what the user did before the crash.

Scout.reportError(new Error('payment failed'));
Scout.logEvent('purchase_completed', { sku: 'SKU-1', amount: '49.99' });
```

---

## Filtering and PII scrubbing — `beforeSend`

Runs on every span / metric / log before export. Return `null` to drop, return the event to send modified.

```ts
beforeSend: (event) => {
  // Drop health checks
  if (String(event['http.url'] ?? '').includes('/health')) return null;
  // Scrub PII
  delete event['enduser.email'];
  return event;
},
```

---

## Sampling — defaults, and how errors stay loud

Scout defaults to **1% session sampling** (`sessionSampleRate: 1`). Out of every ~100 user sessions, only one keeps the full instrumentation trail; the other 99 emit nothing. This keeps telemetry volume (and collector cost) bounded as your app scales.

**Errors are never sampled out by default.** When `alwaysCaptureErrors: true` (the default), these signals bypass the session-sample gate and are always exported, regardless of whether the session was sampled in:

| Signal | Span / log | Why it bypasses |
|---|---|---|
| Caught error reported via `Scout.reportError(...)` | `error` span | You always want failures visible. |
| Uncaught JS exception, unhandled rejection, React error-boundary catch | `error` span | Same — drop on the floor isn't acceptable. |
| `Scout.logError(...)` / ERROR-severity logs | log record | High-severity logs treated like errors. |
| App crash (OOM / force-kill / unclean exit) | `app_crash` on next launch | Crashes that lose the prior session must reach you. |
| Native crash (iOS Mach exception / Android NDK signal / JVM uncaught) | `native_crash` on next launch | Same — fatal-class signal. |
| ANR (app not responding) | `anr` span | Fatal-class UX failure. |

If you set `alwaysCaptureErrors: false`, errors get the same 1% treatment as everything else. Most teams should leave it at the default.

Everything else — `user_interaction`, `screen_view`, `http.request`, `long_task`, `frozen_frame`, web vitals, performance metrics — respects `sessionSampleRate`. Crank it to `100` for dev, leave it at `1` for production high-traffic apps, or set it to something in between (e.g. `10`) for a less aggressive sample.

```ts
Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'https://otel.example.com:4318',

  sessionSampleRate: 1,           // default — 1% of sessions
  alwaysCaptureErrors: true,      // default — errors always export

  // For local dev / staging:
  // sessionSampleRate: 100,      // capture every session
});
```

The sampling decision is made **once per session**, then frozen for that session's lifetime. A session is either fully sampled in (every signal flows) or sampled out (only error-class signals flow). This keeps individual sessions coherent — you never get half-a-trace.

---

## Full configuration

```ts
await Scout.initialize({
  // Required
  serviceName: 'my-app',
  endpoint: 'https://otlp.example.com:4318',

  // Identity / pipeline
  serviceVersion: '1.0.0',
  environment: 'production',
  secure: true,                              // https when scheme omitted
  headers: { Authorization: 'Bearer ...' },  // sent on every OTLP export

  // Auto-instrumentation toggles (all default true)
  enableAutoTapTracking: true,
  enableErrorTracking: true,
  enableLifecycleTracking: true,
  enableStartupTracking: true,
  enableConnectivityTracking: true,
  enablePerformanceMetrics: true,
  enableLongTaskDetection: true,
  enableAnrDetection: true,
  enableFrameMetrics: true,                  // web + RN
  enableMemoryMetrics: true,                 // web + RN
  enableWebVitals: true,                     // web
  enableBatteryTracking: true,
  enableNetworkTracking: true,
  enableLogging: true,
  captureConsole: false,
  capturePrintStatements: false,             // alias for captureConsole

  // Thresholds
  longTaskThresholdMs: 100,
  anrThresholdMs: 5000,

  // Sessions
  sessionSampleRate: 1,                      // 0..100, default 1 (1% of sessions)
  alwaysCaptureErrors: true,                 // errors bypass sessionSampleRate (default true)
  sessionTimeoutMinutes: 30,

  // Network
  firstPartyHosts: ['api.example.com', '*.example.com'],
  ignoreUrlPatterns: [/\/health$/],

  // Storage
  maxOfflineStorageMb: 5,

  // Filtering
  beforeSend: (event) => event,

  // Custom resource attributes
  resourceAttributes: {
    'deployment.region': 'us-east-1',
    team: 'mobile',
  },

  // Export pacing (defaults match production needs)
  metricExportIntervalMs: 30000,
  logExportScheduledDelayMs: 5000,

  // Retry on retryable failures (network errors, 408, 429, 5xx)
  exportRetry: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
  },

  // On-disk offline buffer — replayed on next init / foreground / online
  offlineBuffer: {
    enabled: true,
    maxItems: { traces: 5000, metrics: 2000, logs: 5000 },
  },

  // Debug
  debug: false,
});
```

---

## Background flush

On RN, the SDK calls `Scout.flush()` when `AppState` transitions from `active`
to `background` / `inactive`. On web, it flushes on `visibilitychange =
hidden` and `pagehide`. This drains the BatchSpanProcessor, metric reader,
and log processor before the OS suspends / kills the process — without it,
events emitted in the last few seconds (the ones leading up to a crash)
would die with the in-memory batch queue.

If your in-memory exporter still doesn't deliver in time (e.g. the OS kills
us mid-POST), the **offline buffer** persists the batch to disk and
replays it on next `Scout.initialize()`. See [Configuration → Offline
buffer](docs/configuration.md#offline-buffer).

---

## Out of scope (for now)

| Signal | Why not |
|---|---|
| Session Replay (DOM / view-tree recording) | Heavyweight payload + privacy implications. Not on the roadmap. |
| Profiling (continuous CPU sampling) | No reliable cross-platform sampler. Not on the roadmap. |
| Frame raster time (web) | Browsers expose only whole-frame durations via Long Animation Frame. We emit `web.frame.build_time` covering the full frame. |
| CPU usage (web) | No browser API. |

---

## Runnable samples

| Sample | Stack | How to run |
|---|---|---|
| [`examples/platform-design-web`](examples/platform-design-web/) | Vite + React | `cd examples/platform-design-web && npm run dev` |
| [`examples/platform-design-mobile`](examples/platform-design-mobile/) | Expo + React Native | `cd examples/platform-design-mobile && npx expo run:ios` (or `run:android`). The mobile example bundles the `ScoutCrash` Expo module — `npx expo prebuild` is run automatically the first time. |

Both default to the local OTel collector on `:34318`. The repo includes a sample collector config in `dev/` (gitignored) — point your collector at it or use your own.

---

## Development

```bash
make install            # npm ci
make build              # tsup for web entries, tsc for native (preserves literal require())
make typecheck
make lint
make fmt                # prettier --write
make test               # 90 unit + jsdom integration tests
make test-coverage      # core/** ≥ 75% lines, ≥ 70% functions
make audit              # npm audit prod + all
make ci                 # fmt-check → lint → typecheck → test → build
```

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## License

MIT
