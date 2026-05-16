# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — RUM parity additions

**Web — deep Performance API capture**

- `http.request` spans now carry the full PerformanceResourceTiming phase
  breakdown — `http.phase.dns.{start,duration}_ms`,
  `http.phase.connect.{start,duration}_ms`,
  `http.phase.ssl.{start,duration}_ms`,
  `http.phase.first_byte.{start,duration}_ms`,
  `http.phase.download.{start,duration}_ms`,
  `http.phase.redirect.{start,duration}_ms`,
  `http.phase.worker.{start,duration}_ms` — plus
  `http.response.body.encoded_size`, `http.response.body.decoded_size`,
  `http.transfer_size`, `network.protocol.name`, `http.delivery_type`,
  `http.render_blocking_status`, `http.resource.type`.
- `long_task` spans subscribe to **`long-animation-frame`** entries
  (Chrome 123+) in addition to `longtask`. Adds
  `long_task.blocking_duration_ms`, `long_task.render_start_ms`,
  `long_task.style_and_layout_start_ms`,
  `long_task.first_ui_event_timestamp_ms`, and a JSON-encoded
  `long_task.scripts_json` describing every script that executed during
  the frame.
- `app_startup` (cold) now carries `browser.navigation.dom_complete_ms`,
  `browser.navigation.dom_content_loaded_ms`,
  `browser.navigation.dom_interactive_ms`,
  `browser.navigation.load_event_ms`, `browser.navigation.first_byte_ms`
  from `PerformanceNavigationTiming`.
- CLS layout-shift rects (`web.vital.cls.previous_rect.{x,y,width,height}`
  + `current_rect.*`), INP sub-parts (`web.vital.inp.input_delay_ms`,
  `processing_duration_ms`, `presentation_delay_ms`), LCP sub-parts
  (`web.vital.lcp.load_delay_ms`, `load_time_ms`, `render_delay_ms`,
  `resource_url`), plus `web.vital.target_selector` on CLS / FID / INP /
  LCP.

**React Native — device context + accessibility**

- `network.connectivity.status` / `network.effective_type` /
  `network.interfaces` / `network.cellular.carrier_name` flow through
  NetInfo, refreshed on every change.
- Resource attributes now include `device.architecture`, `device.locale`,
  `device.locales`, `device.time_zone`, `device.power_saving_mode`,
  `device.total_ram`, `device.logical_cpu_count`, `device.is_low_ram`,
  `device.type`.
- 22 `a11y.*` attributes (`screen_reader_enabled`, `bold_text_enabled`,
  `reduce_motion_enabled`, `invert_colors_enabled`, `grayscale_enabled`,
  `assistive_touch_enabled`, `closed_captioning_enabled`, etc.) read from
  `AccessibilityInfo` and a new `ScoutCrash.getAccessibilitySnapshot`
  native bridge — `UIAccessibility` queries on iOS, `Settings.*` queries
  on Android. Refreshed on `app_resumed`.

**Per-view counters + Web Vitals as screen_view attrs**

- `view.action.count`, `view.error.count`, `view.crash.count`,
  `view.long_task.count`, `view.frozen_frame.count`,
  `view.resource.count`, `view.frustration.count` — Counter metrics
  attributed by `screen.name`. 
- Web Vitals also decorate the current `screen_view` span as
  `web.vital.<name>.value` / `.rating` plus the sub-parts above.

**Frustration detection on web**

- `user_interaction` spans now tagged with `action.frustration.type`:
  `rage_click` (≥3 clicks within 1s on the same selector), `dead_click`
  (no DOM mutation within 600ms of the click), `error_click` (uncaught
  error within ±100ms of the click). New `view.frustration.count` metric
  rolls these up per screen.

**GraphQL + provider classification**

- `http.request` body inspected at call-time for GraphQL operations.
  Adds `graphql.operation.type` (query/mutation/subscription),
  `graphql.operation.name`, `graphql.variables` (capped),
  `graphql.error.count`, `graphql.errors_json` (capped).
- URL → provider lookup table classifies third-party requests:
  `http.provider.name` (`google-fonts`, `stripe`, `cloudfront`, etc.),
  `http.provider.type` (`cdn`, `analytics`, `ad`, `tag-manager`,
  `social`, `content`, `customer-success`, `utility`, `hosting`),
  `http.provider.domain`.

**New public APIs**

- `Scout.addTiming(name)` — user-defined named timing relative to current
  screen_view start. Emits `custom_timing` span and decorates the active
  root span with `view.custom_timings.<name>`.
- `Scout.startVital(name)` / `Scout.endVital(name)` — user-defined named
  durations. Emits `custom_vital` span with `vital.type = "duration"`.
- `Scout.recordOperationStep(name, "start"|"update"|"retry"|"end", opts)`
  — multi-step business-operation tracking. Emits `operation_step` span.
- `Scout.setFeatureFlag(name, value)` / `clearFeatureFlags()` — attach
  `feature_flag.<name>` to every subsequent span/metric/log via runtime
  attributes, so error spans automatically carry the flag values that
  were active at error time.
- `Scout.setAccount(id, name?)` / `clearAccount()` — B2B SaaS account
  identifier alongside `setUser` (sessions groupable by tenant).

**SDK self-telemetry logs**

- `scout.config` log emitted once at session start with ~30 SDK config
  fields as attributes (`scout.config.session_sample_rate`,
  `scout.config.long_task_threshold_ms`, `scout.config.capture_console`,
  `scout.config.use_before_send`, `scout.config.first_party_hosts_count`,
  etc.). Tagged with `scout.diag = true` so users can filter telemetry
  out of business dashboards.
- `scout.usage` log emitted the first time each public API is called per
  session (`logEvent`, `setUser`, `setAccount`, `setFeatureFlag`,
  `addTiming`, `startVital`, `endVital`, `recordOperationStep`,
  `reportError`).

**Native signal-based crash capture**

- **iOS — KSCrash 2.5+** wired as the primary native-crash subsystem.
  Additionally extracts the ARM64 exception-state registers — `far` and
  `esr` — into `crash.fault_address_register` and
  `crash.exception_syndrome_register` so the OTLP span matches the
  bottom two lines of Apple's `.ips` report exactly.
  Replaces the hand-rolled `NSSetUncaughtExceptionHandler` and POSIX
  signal handler with KSCrash's mach-exception / signal / NSException /
  C++ exception / main-thread-deadlock / user-reported monitors. The
  `native_crash` span now carries the same data Apple's `.ips` files do:
  mach exception type + code (`crash.mach_exception = "EXC_BAD_ACCESS"`,
  `crash.mach_code`), all threads' stacks (symbolicated where KSCrash can
  via `dladdr`; raw addresses for the host app's own frames which the
  backend symbolicates via uploaded `.dSYM`), full register dump for the
  crashed thread (`crash.registers_json`), binary images with UUIDs
  (`crash.binary_images_json`), OS / kernel / device / CPU / build-type
  metadata. The hand-rolled `ScoutSignalHandler.{h,m}` and POSIX
  signal handler remain in the tree as a fallback but are not installed
  by default.
- **Android — NDK signal handler:** `cpp/scout_signal_handler.c` + JNI
  bridge — 6 signals via `sigaction`, stack via `_Unwind_Backtrace`.
  Linked as a shared library (`libscout_signal_handler.so`) and loaded
  lazily from `ScoutNdkSignalHandler.kt`. Reports tagged
  `crash.type = "ndk_signal"`. (No KSCrash equivalent on Android —
  `ApplicationExitInfo` covers the bulk of native deaths via tombstone
  retrieval on next launch.)

**Apple-grade crash diagnostics via MetricKit (iOS)**

- New `ScoutMetricKitCollector` (iOS 14+) subscribes to
  `MXMetricManager`. On `didReceive(_ payloads:)` writes one report per
  `MXCrashDiagnostic` (`mxc_*.json`) and per `MXHangDiagnostic`
  (`mxh_*.json`). Carries `crash.exception_type`, `crash.exception_code`,
  `crash.termination_reason`, `crash.application_version`,
  `crash.application_build_version`, `crash.os_version`,
  `crash.device_type`, `crash.region_format`,
  `crash.callstack_tree_json` (full multi-thread tree from
  `MXCallStackTree.jsonRepresentation()`, truncated at 32KB), and for
  hangs `crash.hang_duration_ms`. Reports arrive ~24h after the crash;
  the existing signal-handler path remains for next-launch coverage.

**OS-recorded process deaths via ApplicationExitInfo (Android)**

- New `ScoutExitInfoCollector` (API 30+, Android 11+) — polls
  `ActivityManager.getHistoricalProcessExitReasons` on every SDK init,
  emits one report (`exit_*.json`) per OS-recorded process death newer
  than the persisted watermark. Persists `last_timestamp` in a
  SharedPreferences file so the same death isn't reported twice.
  Captures `crash.os_reason_code` / `crash.os_reason_name` (`crash`,
  `crash_native`, `anr`, `low_memory`, `excessive_resource_usage`,
  `initialization_failure`, `signaled`), `crash.exit_status`,
  `crash.death_timestamp_ms`, `crash.process_name`, `crash.pid`,
  `crash.importance`, `crash.pss_kb`, `crash.rss_kb`, plus the full
  thread dump or tombstone in `crash.tombstone` (capped at 32KB).

### Changed

- `crash-test` local Expo module added inside
  `examples/platform-design-mobile/modules/crash-test/` (NOT part of the
  SDK). Provides `crashWithSignal("SIGSEGV" | "SIGABRT" | …)` so the
  diagnostics panel can verify native-signal capture end-to-end.

### Tests

- 107 tests pass (up from 90). New contract tests for resource-timing
  attribute mapping, GraphQL request/response parsing, and provider
  classification.

---

## [0.1.1] - 2026-05-13

### Changed

- **InstrumentationScope name is now `base14.scout.react`** (was
  `@base14/scout-react`). Every span, metric, and log emitted by the SDK
  carries this scope, enforced by a CI guard test that fails the build if
  any code path mints a different scope name. Backend queries filtering on
  `scope.name` must be updated.

### Added

- **`react_native.memory.usage`** (gauge, bytes) on RN — polls
  `react-native-device-info`'s `getUsedMemory()` every 10 seconds. Reaches
  parity with the existing `web.memory.usage` metric on the web side.
- **`react_native.frame.build_time`** (histogram, ms) on RN — samples
  `requestAnimationFrame` deltas and emits any frame longer than 50 ms.
- **`react_native.frame.dropped`** (gauge, count) on RN — emitted every
  10 seconds with the count of frames exceeding the 60Hz vsync budget
  (~32 ms) since the last report.
- **`long_task`** + **`frozen_frame`** spans on RN — derived from the
  same rAF loop. Threshold from `longTaskThresholdMs` (default 100 ms);
  frames ≥ 700 ms additionally emit `frozen_frame`. Matches the web shape.
- **`captureConsole`** instrumentation wired on RN — calls to
  `console.debug/log/info/warn/error` become OTLP log records with the
  appropriate severity. Already shipped on web.
- **`native_crash`** capture on iOS — `NSSetUncaughtExceptionHandler`
  catches uncaught `NSException`s on any thread. Reports persist to
  `caches/scout-crash/pending/`; next launch emits a `native_crash` span
  carrying `crash.type`, `crash.reason`, `crash.nsexception_name`,
  `crash.stack_trace` (from `callStackSymbols`), `crash.thread`, and the
  prior session's breadcrumbs.
- **`native_crash`** capture on Android — uncaught Java/Kotlin
  exceptions via `Thread.setDefaultUncaughtExceptionHandler`. Same
  on-disk persistence + on-launch span shape as iOS.
- New **Expo Module** (`ScoutCrash`) bundled inside the package
  (`ios/ScoutCrashModule.swift` + `android/.../ScoutCrashModule.kt` +
  `expo-module.config.json`). Auto-links via `expo install`. Requires a
  development build (`npx expo prebuild && expo run:ios|android`) — not
  available on Expo Go.

### Fixed

- `beforeSend` now actually applies its returned attributes to metric
  emissions (`emitGauge`, `emitHistogram`). Previously the filtered
  attributes were computed and discarded — PII scrubbing worked on spans
  and logs but leaked into metrics.

### Known limitations

- **iOS signal-based crashes (SIGSEGV/SIGABRT/SIGBUS/etc.) and mach
  exceptions** are not yet captured will integrate KSCrash
  (2.5+) for the full coverage. The persisted-report shape is already
  compatible.
- **Android native signal crashes (NDK code)** are not yet captured.
  will add a C signal handler with libunwind, writing into the
  same directory.

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

[0.1.0]: https://github.com/base-14/scout-react/releases/tag/v0.1.0
