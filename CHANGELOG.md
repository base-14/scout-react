# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-05-13

### Added

- **`react_native.memory.usage`** (gauge, bytes) on RN — polls
  `react-native-device-info`'s `getUsedMemory()` every 10 seconds. Reaches
  parity with the existing `web.memory.usage` metric on the web side.
- **`react_native.frame.build_time`** (histogram, ms) on RN — samples
  `requestAnimationFrame` deltas and emits any frame longer than 50 ms.
- **`react_native.frame.dropped`** (gauge, count) on RN — emitted every
  10 seconds with the count of frames exceeding the 60Hz vsync budget
  (~32 ms) since the last report.

Now both web and RN emit memory and frame metrics under platform-prefixed
names (`web.*` / `react_native.*`) so a single dashboard can filter by
`os.name` resource attribute and chart memory / frame timings uniformly.

## [0.1.0] - 2026-05-13

Initial release.

### Added

- **Web entry (`@base14/scout-react`)** — bundled via tsup, ESM + CJS + d.ts.
  - Auto-captures: clicks (`user_interaction`), route changes (`screen_view`,
    `screen_load`, `view_session`), uncaught errors, unhandled rejections,
    fetch + XHR (`http.request`), lifecycle (visibilitychange), app startup
    (cold / warm via bfcache), long tasks, frozen frames (≥ 700 ms), memory
    (`Performance.memory`, Chromium), frame build time (`Long Animation Frame`),
    web vitals (LCP / FID / CLS / INP / TTFB / FCP), battery
    (`navigator.getBattery`), session marker crashes (`app_crash` on next load).
  - ANR detection via Web Worker watchdog.
  - W3C `traceparent` header injection on `firstPartyHosts` — backend spans
    parent under the browser's `http.request` span.
  - Per-screen trace propagation: each `screen_view` is a long-lived root
    span; every span on that screen shares its trace id.
- **React subpath (`@base14/scout-react/react`)** — `ScoutProvider`,
  `useScout` hook, `ScoutErrorBoundary`, `ScoutAction` annotation wrapper.
- **Native entry (`@base14/scout-react/native`)** — compiled via `tsc` (no
  bundling) so Metro's static analyzer sees literal `require("react-native")`
  and bundles peer deps correctly.
  - `Scout.registerRootComponent(App)` — installs a root-level wrapper via
    `AppRegistry.setWrapperComponentProvider` that combines error capture
    (every render error → `error` span with `error.component_stack`) and
    touch capture (every tap → `user_interaction` span). No per-button
    wrapping or boundaries needed in the host app.
  - Auto-captures: ErrorUtils-level uncaught + fatal errors, Hermes-based
    unhandled rejection tracker, AppState lifecycle, fetch (RN),
    `@react-navigation/native` integration via
    `Scout.attachNavigationContainer(navRef)`.
  - ANR detection via timer-drift watchdog.
  - Crash detection via persistent AsyncStorage session marker.
  - Optional peer deps soft-loaded with a suppression guard:
    `react-native-device-info`, `@react-native-community/netinfo`,
    `expo-battery`.
- **Battery** — `device.battery.level` (0–100) and `device.battery.state`
  (`charging` / `discharging` / `full` / `unknown`) on both web and RN.
- **Device / OS context** — captured once at session start and attached as
  resource attributes: `device.model.name`, `device.manufacturer`,
  `device.brand`, `device.is_physical`, `os.name`, `os.version`,
  `screen.width`, `screen.height`, `screen.pixel_ratio`.
- **Custom resource attributes** — `config.resourceAttributes` merges into
  every `ResourceSpans` / `ResourceMetrics` / `ResourceLogs` batch.
- **`beforeSend` filter** — drop or modify any span / metric / log before
  export.
- **OTLP/HTTP exporters** for traces, metrics, and logs. Configurable export
  intervals (`metricExportIntervalMs`, `logExportScheduledDelayMs`).
- **OAuth2-aware collector pipeline** — works end-to-end with the
  `oauth2client` extension in `otelcol-contrib`, gzip-compressed export.
- **`firstPartyHosts`** — accepts exact hosts, `*.example.com` wildcards, or
  RegExps.
- **CI workflow** (`.github/workflows/ci.yml`) — Node 20 + 22 matrix,
  `fmt:check → lint → typecheck → test:coverage → build → npm audit`.
- **88 tests** across 13 files: core orchestrator, before-send, session +
  breadcrumb managers, config, attribute contract lock-in, web tap / route /
  error / network jsdom integration tests.

### Known limitations

- Native signal crashes (SIGSEGV / NSException) are out of scope — those
  require a native crash module. JS-fatal errors still flow through
  `ErrorUtils` → `error.handled=false`.

[0.1.0]: https://github.com/base-14/scout_react/releases/tag/v0.1.0
