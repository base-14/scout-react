# @base14/scout-react

Zero-config OpenTelemetry RUM for **React (browser) and React Native**. Sister package to [`scout_flutter`](https://github.com/base-14/scout_flutter) — same attribute keys, same span names, one collector.

Install once, call `Scout.initialize()`, and you get clicks, navigation, errors, lifecycle, network, web vitals (web), and logs exported over OTLP/HTTP.

## Install

```bash
npm install @base14/scout-react
# or
yarn add @base14/scout-react
# or
pnpm add @base14/scout-react
```

## Quick start — React (browser)

```ts
import Scout from '@base14/scout-react';

await Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'https://otlp.example.com:4318',
});
```

Or as a provider, so you can read sessionId from React state:

```tsx
import { ScoutProvider, useScout } from '@base14/scout-react/react';

function App() {
  return (
    <ScoutProvider config={{ serviceName: 'my-app', endpoint: 'https://otlp.example.com:4318' }}>
      <Routes />
    </ScoutProvider>
  );
}

function CheckoutButton() {
  const scout = useScout();
  return (
    <button onClick={() => scout.logEvent('purchase', { item: 'widget' })}>
      Buy
    </button>
  );
}
```

Wrap your top-level component in `ScoutErrorBoundary` to capture render errors:

```tsx
import { ScoutErrorBoundary } from '@base14/scout-react/react';

<ScoutErrorBoundary fallback={<ErrorScreen />}>
  <App />
</ScoutErrorBoundary>
```

## Quick start — React Native

```ts
import Scout from '@base14/scout-react/native';

await Scout.initialize({
  serviceName: 'my-app',
  endpoint: 'https://otlp.example.com:4318',
});
```

Wire up `@react-navigation/native` for automatic screen tracking:

```tsx
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import Scout from '@base14/scout-react/native';

function Root() {
  const ref = useNavigationContainerRef();
  return (
    <NavigationContainer ref={ref} onReady={() => Scout.attachNavigationContainer(ref)}>
      {/* ... */}
    </NavigationContainer>
  );
}
```

Optional peer dependencies for richer device data:

```bash
npm install @react-native-async-storage/async-storage  # session/breadcrumb persistence
npm install @react-native-community/netinfo            # connectivity
npm install react-native-device-info                   # device model/manufacturer
```

## What's captured

### Auto-captured on both platforms

| Signal | Span / Metric | Notes |
|---|---|---|
| Clicks / taps | `user_interaction` | `user_interaction.type=click`, `user_interaction.target`, `user_interaction.target.type` |
| Navigation | `screen_view`, `view_session` | Web: history API; RN: react-navigation ref |
| Screen load time | `screen_load` | `screen.load_time` in seconds |
| Errors (uncaught) | `error` span + `error.count` metric | `error.handled=false`, breadcrumbs attached |
| Errors (manual) | `error` | `Scout.reportError(err)` — `error.handled=true` |
| Lifecycle | `app_paused`, `app_resumed` | Web: visibilitychange; RN: AppState |
| Network | `http.request` | `http.method`, `http.url`, `http.status_code`, `http.duration_ms`, `http.response_content_length`, `http.error` |
| App startup | `app_startup` | `app_startup.type=cold|warm`, `app_startup.duration` |
| Crash detection | `app_crash` | Session-marker check on next boot |
| Logs | OTLP logs | DEBUG / INFO / WARN / ERROR with severity_number 5 / 9 / 13 / 17 |

### Web only

| Signal | Span / Metric | Notes |
|---|---|---|
| Web vitals | `web.vital.lcp/fid/cls/inp/ttfb/fcp` histograms + `web_vital` spans | Powered by `web-vitals` |
| Long task | `long_task` | PerformanceObserver, default threshold 100ms |
| Frozen frame | `frozen_frame` | Long task ≥ 700ms |
| Memory | `web.memory.usage` gauge | Chromium only, polled every 10s |
| Console capture | OTLP logs | Opt-in via `captureConsole: true` |

### Common attribute keys (parity with `scout_flutter`)

All spans/logs carry: `session.id`, `network.connection.type`, and `enduser.id` (when set). Distributed tracing injects a W3C `traceparent` header on first-party requests.

## Configuration

```ts
await Scout.initialize({
  // Required
  serviceName: 'my-app',
  endpoint: 'https://otlp.example.com:4318',

  // Identity
  serviceVersion: '1.0.0',
  environment: 'production',
  secure: true,                                // HTTPS when scheme omitted
  headers: { Authorization: 'Bearer ...' },    // sent on every OTLP export

  // Auto-instrumentation toggles (all default true unless noted)
  enableAutoTapTracking: true,
  enableErrorTracking: true,
  enableLifecycleTracking: true,
  enableStartupTracking: true,
  enableConnectivityTracking: true,
  enablePerformanceMetrics: true,
  enableLongTaskDetection: true,
  enableMemoryMetrics: true,                   // web only
  enableWebVitals: true,                       // web only
  enableNetworkTracking: true,
  enableLogging: true,
  captureConsole: false,

  // Thresholds
  longTaskThresholdMs: 100,                    // min 20

  // Sessions
  sessionSampleRate: 100,                      // 0–100
  sessionTimeoutMinutes: 30,

  // Network
  firstPartyHosts: ['api.example.com'],
  ignoreUrlPatterns: [/\/health$/],

  // Storage
  maxOfflineStorageMb: 5,

  // Filtering
  beforeSend: (event) => {
    if (event['http.url']?.toString().includes('/health')) return null;
    delete event['enduser.email'];
    return event;
  },

  // Resource attributes
  resourceAttributes: { 'deployment.region': 'us-east-1' },
});
```

## Custom events, breadcrumbs, errors

```ts
Scout.logEvent('purchase', { item: 'widget', amount: 19.99 });
Scout.addBreadcrumb('checkout', 'added item to cart');
Scout.reportError(new Error('payment failed'), { handled: true });

Scout.setUser('user-123', { email: 'user@example.com', plan: 'pro' });
Scout.clearUser();
```

## Structured logging

```ts
Scout.logDebug('Cache hit for product list');
Scout.logInfo('User completed checkout', { amount: 19.99 });
Scout.logWarning('Retry attempt 2');
Scout.logError('Payment gateway timeout');
```

Each log lands as an OTLP log record with `session.id`, current `enduser.id`, and severity 5/9/13/17.

## Architecture

Scout React exports OTLP/HTTP for **traces**, **metrics**, and **logs**. The shape, names, and attribute keys match `scout_flutter` exactly so a single collector and a single dashboard can serve both your Flutter and React/RN deployments.

| | scout_flutter | scout-react (web) | scout-react/native |
|---|---|---|---|
| `user_interaction` | Yes | Yes | Yes |
| `screen_view` / `screen_load` | Yes | Yes | Yes (with `attachNavigationContainer`) |
| `error` (uncaught) | Yes | Yes | Yes |
| `app_paused` / `app_resumed` | Yes | Yes | Yes |
| `app_crash` (session marker) | Yes | Yes | Yes |
| `native_crash` (signal/JVM) | Android only | n/a | n/a |
| `app_startup` cold/warm | Yes | Yes | Partial |
| `long_task` / `frozen_frame` | Yes | Yes | n/a |
| `anr` | Yes | n/a (use long_task) | n/a |
| Web vitals (LCP/FID/CLS/INP) | n/a | Yes | n/a |
| `http.request` (fetch + XHR) | Yes (HttpOverrides + Dio) | Yes | Yes |
| Logs | Yes | Yes | Yes |

## Runnable samples

Two ready-to-run sample apps live under `examples/`:

| Sample | What it is | How to run |
|---|---|---|
| [`platform-design-web`](examples/platform-design-web/) | Vite + React, 4-tab music app modeled on Flutter's `platform_design`. Diagnostics panel drives every scout-react signal. | `make demo` — opens http://127.0.0.1:5174 with a local OTel collector on :34318 |
| [`platform-design-mobile`](examples/platform-design-mobile/) | Expo + React Native version of the same UX for iOS simulator and Android USB. | `make mobile-ios` or `make mobile-android` |

Both apps point at the same local collector and use the same attribute keys, so
you can swap between them and see identical-shaped data land in one place.

## License

MIT
