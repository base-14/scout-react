# @base14/scout-react

Zero-config OpenTelemetry RUM for **React (browser) and React Native**.

Install once, call `Scout.initialize()`, get clicks / navigation / errors / lifecycle / network / web vitals / crashes / device context exported over OTLP/HTTP.

```ts
import Scout from '@base14/scout-react';

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
npm install @base14/scout-react

# from git
npm install github:base-14/scout_react#v0.1.0
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
import Scout from '@base14/scout-react';

await Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'https://otlp.example.com:4318',
});
```

That's it. Clicks, route changes, errors, fetch + XHR, lifecycle, web vitals, long tasks, memory, and crashes are all auto-captured. No per-button instrumentation.

Optional React helpers from the `/react` subpath:

```tsx
import { ScoutProvider, useScout, ScoutErrorBoundary, ScoutAction } from '@base14/scout-react/react';

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
import Scout from '@base14/scout-react/native';
import App from './App';

Scout.registerRootComponent(App);
```

`registerRootComponent` installs a root-level error + touch boundary via RN's `AppRegistry.setWrapperComponentProvider`. Every tap becomes a `user_interaction` span, every render error becomes an `error` span (with `error.component_stack`), automatically.

Then in your `App.tsx`:

```tsx
import Scout from '@base14/scout-react/native';
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
| Logs | OTLP logs | `Scout.logDebug/Info/Warning/Error` |

### Web only

| Signal | Notes |
|---|---|
| Web vitals | LCP, FID, CLS, INP, TTFB, FCP via `web-vitals` |
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

### Resource attributes (shared across all signals)

Attached to every `ResourceSpans` / `ResourceMetrics` / `ResourceLogs` batch:

- `service.name`, `service.version`, `environment`
- `os.name`, `os.version`
- `device.model.name`, `device.manufacturer`, `device.brand`, `device.is_physical`
- `screen.width`, `screen.height`, `screen.pixel_ratio`
- `device.battery.level`, `device.battery.state`
- Anything you pass via `config.resourceAttributes` (e.g. `deployment.region`, `team`)

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
  enableFrameMetrics: true,                  // web
  enableMemoryMetrics: true,                 // web
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
  sessionSampleRate: 100,                    // 0..100
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

  // Debug
  debug: false,
});
```

---

## Out of scope

| Signal | Why not |
|---|---|
| Native signal crashes (SIGSEGV / NSException / JVM exceptions) | Require a native crash module (KSCrash / Crashpad / NDK signal handlers). Out of scope for an OTLP-only JS SDK. JS-fatal errors still flow through `ErrorUtils` and are captured as `error` spans with `handled=false`. |
| Frame raster time (web) | Browsers expose only whole-frame durations via Long Animation Frame. We emit `web.frame.build_time` covering the full frame. |
| CPU usage (web) | No browser API. |

---

## Runnable samples

| Sample | Stack | How to run |
|---|---|---|
| [`examples/platform-design-web`](examples/platform-design-web/) | Vite + React | `make demo` — http://localhost:5174 |
| [`examples/platform-design-mobile`](examples/platform-design-mobile/) | Expo + React Native | `npx expo run:ios` or `npx expo run:android` |

Both point at the same local OTel collector (`make collector` brings one up on `:34318`).

---

## Development

```bash
make install            # npm ci
make build              # tsup for web entries, tsc for native (preserves literal require())
make typecheck
make lint
make fmt                # prettier --write
make test               # 88 unit + jsdom integration tests
make test-coverage      # core/** ≥ 75% lines, ≥ 70% functions
make audit              # npm audit prod + all
make ci                 # fmt-check → lint → typecheck → test → build
```

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## License

MIT
