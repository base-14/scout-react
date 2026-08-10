# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.15] - 2026-08-10

### Fixed

- Web Vitals now emit their core attributes under the `web.vital.*` namespace.
  `vital.name`, `vital.value`, `vital.rating`, `vital.id` and
  `vital.target_selector` were missing the `web.` prefix that every sibling
  attribute (`web.vital.cls.*`, `web.vital.inp.*`, `web.vital.lcp.*`), the
  emitted metrics (`web.vital.lcp`, `web.vital.fcp`, …) and the root-span
  rollups (`web.vital.<name>.value`) already used. Backends projecting
  `web.vital.name`/`value`/`rating` read empty values, so `web_vital` events
  rendered without a name or a measurement. The old keys also collided with
  the mobile `app_vital` schema, which owns `vital.name` and `vital.type`.

  **Breaking for consumers of the old keys:** the previous `vital.*` names are
  no longer emitted. Telemetry already ingested keeps the old attribute names.

## [0.1.14] - 2026-08-05

### Fixed

- `Scout.shutdown()` now genuinely stops Web Vitals. `installWebVitalsTracker`
  returned a no-op disposer, so the `web-vitals` observers — which have no
  unsubscribe API — kept reporting after shutdown, and every re-`initialize()`
  stacked another live callback. Registration is now once per document, routed
  to whichever instance is currently installed.
- `installStartupTracker` no longer re-emits a `cold` `app_startup` span when
  the SDK is re-initialized on the same document. Navigation timing describes
  the document, so the repeat carried byte-identical timings and skewed startup
  percentiles.
- `installRouteTracker` now restores the real `history.pushState` /
  `history.replaceState` on dispose. It captured `history.pushState.bind(history)`
  and restored that wrapper instead of the original, so every install/uninstall
  cycle left another `bind` layer on `history` — an unbounded chain for a host
  that mounts the SDK on every visit.

### Added

- `src/web/lifecycle.test.ts` covers `Scout.initialize` / `Scout.shutdown`,
  which had no tests: that shutdown restores every patched page global, and that
  install/uninstall cycles neither stack patches nor wedge re-initialization.

Both matter to hosts that mount and unmount the SDK rather than initializing
once per page load — Grafana app plugins and micro-frontends, where scoping
capture to the host's own lifetime is the only way to keep `service.name`
meaning what it says.

## [0.1.13] - 2026-08-05

Web interaction coverage and a distributed-tracing correctness fix. No default
turns anything off; `input` tracking is new and on by default — narrow it with
`interactionEvents` if your UI is text-heavy.

### Added

- **Interaction coverage beyond `click`.** Auto-tap tracking now also emits
  `user_interaction` spans for `change` (select / checkbox / radio / file /
  date / time / range), `submit` (form submission *and* Enter in a text entry,
  which React handlers routinely swallow), and `input` (debounced 500 ms after
  typing stops, one span per settled edit). `user_interaction.type` carries
  which one it was; existing `click` spans are unchanged.
- `interactionEvents` config option — the subset of
  `['click','change','submit','input']` to listen to. Defaults to all four;
  `[]` disables interaction tracking without touching `enableAutoTapTracking`.
- `user_interaction.trigger` attribute (`pointer` | `keyboard` | `unknown`),
  which distinguishes Enter-to-search from clicking a search button.
- `user_interaction.value` attribute, set only for controls with a closed value
  space (selected option label, `checked`/`unchecked`). Free text is never
  captured, and `password`/`email`/`tel`/`hidden` fields emit no `input` span at
  all and report their description as `redacted` rather than falling through to
  neighbouring text content.
- `Scout.startTrackedSpan()` — starts a span the caller ends later, applying the
  same `beforeSend`, sampling and view-counter bookkeeping as `emitSpan`. Needed
  wherever a span's ids must be known before the work it measures completes.

### Fixed

- **`XMLHttpRequest` sent a fabricated `traceparent`.** The header was built
  from fresh random ids rather than the emitted `http.request` span's, so XHR
  calls never correlated with their own span or with the backend, and the
  backend saw a parent span id it would never receive. Both `fetch` and XHR now
  derive the header from the span they actually export.
- A failed `XMLHttpRequest` emitted **two** `http.request` spans, because both
  the `error` and `loadend` listeners ran the finalizer.
- `fetch` spans were bypassing `beforeSend` and were not counted in
  `view.resource.count`; only the XHR path was. Both now behave identically.
- XHR `http.request` spans had a near-zero duration, since the span was created
  after the request finished. They now span the request.

### Changed

- XHR `http.request` spans now carry `http.provider.*` classification, which
  previously only `fetch` spans had.
- Documented that `headers` is read per export, so an expiring bearer token can
  be rotated by mutating the object passed to `initialize` — no re-init, no
  dropped batches. Locked by tests in `otlp-exporter.test.ts` / `config.test.ts`.

## [0.1.12] - 2026-08-03

Brings scout-react to parity with scout-flutter 0.1.23's production-hardening
work. **This release changes defaults.** Upgrading without action silently
turns off periodic vitals metrics, export retries and offline buffering, and
slows trace/log export from 5s to 30s. All of it is opt-in-able — see below.

### Changed — behavior (action required)

- **Vitals metrics are now opt-in.** `enableFrameMetrics`, `enableMemoryMetrics`
  and `enableCpuMetrics` default to `false` (were `true`). These are the
  highest-volume signals the SDK produces. A default `Scout.initialize()` now
  emits **no periodic metrics at all**. Restore with
  `{ enableFrameMetrics: true, enableMemoryMetrics: true, enableCpuMetrics: true }`.
- **Delivery is at-most-once.** `exportRetry.maxRetries` defaults to `0` (was
  `3`) and `offlineBuffer.enabled` to `false` (was `true`, with 5000/2000/5000
  item caps now `0`). Retrying an ambiguous failure — a timeout the collector
  may already have ingested — re-delivers identical span IDs; no duplicates is
  worth more than lossless delivery for RUM data. Restore with
  `{ exportRetry: { maxRetries: 3 }, offlineBuffer: { enabled: true, maxItems: {...} } }`.
- **Export cadence is 30s for all signals** (traces and logs were 5s; metrics
  unchanged at 30s). Tune with `exportIntervalSeconds`.
- **Vitals sampling is 60s** (memory/CPU/frame were 10s). Tune with
  `vitalsCollectionIntervalSeconds`.
- **Android exit-info records are no longer all crashes.** Only `REASON_CRASH`,
  `REASON_CRASH_NATIVE`, `REASON_ANR` and `REASON_LOW_MEMORY` are reported.
  Swipe-from-recents, Force Stop, self-exit, `REASON_SIGNALED`,
  `REASON_EXCESSIVE_RESOURCE_USAGE` and `REASON_INITIALIZATION_FAILURE` are
  normal process exits and are dropped — they were inflating crash counts with
  ordinary user actions.
- **`crash.type` on exit-info records now carries the real reason**
  (`jvm_crash`, `native_crash`, `anr`, `low_memory`) instead of the constant
  `"exit_info"`. **Dashboards filtering `crash.type = 'exit_info'` must move to
  the new `crash.source = 'exit_info'` attribute.**
- **Breadcrumbs are session-scoped.** A relaunched session no longer inherits
  the previous session's breadcrumb trail; those crumbs are attached to crash
  reports drained from the session that died instead.
- **`app_crash` is attributed to the crashed session.** `session.id` and
  `session.start_time` on the span are now the dead session's, and
  `crash.timestamp` is when the app was last known alive rather than when the
  crash was noticed on relaunch.

### Added

- `exportIntervalSeconds` (default 30, min 1) — one cadence for traces, logs
  and metrics. Per-signal `traceExportIntervalMs` / `logExportScheduledDelayMs`
  / `metricExportIntervalMs` still win when set explicitly.
- `metricExportIntervalSeconds` — metrics-only override.
- `maxExportBatchSize` (512) and `maxQueueSize` (2048) — applied to the trace
  and log processors.
- `vitalsCollectionIntervalSeconds` (default 60, min 1) — sampling cadence for
  memory, CPU, frame and battery vitals.
- `scout.react.version` resource attribute on every span, metric and log, on
  both web and native. Pinned to `package.json` by a CI contract test and not
  overridable via `resourceAttributes`.
- `crash.source` — which detection path produced a crash record.
- `crash.drain_app_state`, `crash.drain_process_start_time` and
  `crash.drain_uptime_secs` on drained native crash reports.
- Kotlin unit tests (`android/unit-tests`, `make test-android`) covering the
  exit-info classification and ANR hang-detection rules, plus a CI job.
- `make check-exports` (`publint` + `arethetypeswrong`), wired into `make ci`.
  Both pack the real tarball, so the exports map and the type-resolution matrix
  are checked as consumers see them.

### Fixed

- **Duplicate exports.** The stock `@opentelemetry/exporter-*-otlp-http`
  exporters wrap their transport in `RetryingTransport`, which re-sends up to
  five more times on 429/502/503/504 and on network errors — stacked under the
  SDK's own retry wrapper, one batch could reach the collector ~20 times.
  Replaced with a fetch-based OTLP/JSON exporter where one export is exactly
  one request; retry policy now lives in one place and is off by default.
- **Offline buffering was silently dead at zero retries.** The retry wrapper
  returned the exporter untouched when `maxRetries <= 0`, so the hook that
  feeds the offline buffer never ran. It now wraps whenever a buffer or debug
  logging is wired up.
- **Console-capture feedback loop.** With `captureConsole` + `debug`, the SDK's
  own `[scout]` diagnostics were captured as logs, which produced more exports,
  which logged again. `[scout]`-prefixed lines are no longer captured.
- **Web `crash.started_at` was the marker's write time**, not the session's
  start time.
- ANR detection latency: the watchdog polls every 100ms instead of
  `threshold/10` (500ms at the default threshold), so a hang is reported at
  threshold + ~0.1s.
- **Subpath types were unresolvable under classic `moduleResolution: "node"`.**
  `@base-14/scout-react/native`, `/react` and `/babel-plugin` all failed to
  resolve types — which covers most React Native tsconfigs. Added
  `typesVersions` mappings.
- **CJS consumers got ESM types.** The single top-level `types` condition was
  reused for `require`, so a CJS `import` saw ESM declarations ("masquerading
  as ESM"). `import` and `require` now carry their own `types` pointing at
  `.d.ts` / `.d.cts` respectively.
- **`./native` was unloadable from Node.** `tsconfig.native.json` emits
  CommonJS, but the root package is `"type": "module"`, so Node read
  `dist/native/**` and `dist/core/**` as ESM and every `require` threw. Both
  directories now carry a `{"type":"commonjs"}` marker. Metro was unaffected
  either way; this fixes Jest, SSR and other Node-based consumers.
- **`./babel-plugin` shipped no type declarations at all.** Added
  `babel-plugin/index.d.cts`, including the `components` / `handlers` options.

### Removed

- Dependencies on `@opentelemetry/exporter-trace-otlp-http`,
  `@opentelemetry/exporter-metrics-otlp-http` and
  `@opentelemetry/exporter-logs-otlp-http`, replaced by a direct dependency on
  `@opentelemetry/otlp-transformer`.

## [0.1.11] - 2026-06-30

### Added

- **`crash.build_fingerprint` on Android NDK signal-handler crashes.**
  Captures `Build.FINGERPRINT` (ROM identifier) via JNI from the Java
  layer; emitted on every `native_crash` span produced from the NDK
  signal handler. Matches scout-flutter's NDK report.
- **`crash.exception_register` on Android NDK signal-handler crashes
  (arm64).** Dumps `x16` and `x17` from `ucontext->uc_mcontext.regs`
  in the signal handler so PAC/BTI faults and indirect-branch failures
  can be diagnosed. Other architectures emit no `exception_register`.
- **`crash.app_id` on iOS KSCrash reports.** Aliases the existing
  `crash.bundle_id` to the `crash.app_id` attribute KSCrash already
  exposes, so downstream consumers can read either name. Matches
  scout-flutter's KSCrash mapping.
- **`crash.stack_trace` and `crash.app_version` on iOS MetricKit
  crash/hang reports.** Mirrors `crash.callstack_tree_json` and the
  existing application-version attribute under canonical names used
  by the dashboard.

### Changed

- **`crash.type` on iOS KSCrash reports now carries the actual error
  type** (`mach`, `signal`, `nsexception`, `cppexception`) instead of
  the literal `"kscrash"`. The previous value was an internal source
  tag rather than a useful diagnostic.

### Fixed

- **NDK signal-handler crash reports were silently dropped on Android
  when breadcrumbs filled the 32 KiB write buffer.** The handler used
  `safe_append` to write the breadcrumb blob, which truncated mid-string
  and produced invalid JSON; Android's `JSONObject` parse then failed
  and the entire report was dropped on the next launch. The handler
  now skips the breadcrumbs field entirely when it would not fit,
  preserving the rest of the report (signal context, register dump,
  binary images, session id, etc.).

## [0.1.10] - 2026-06-29

### Added

- **`screen_load` span on React Native navigation transitions.** Emitted
  by `installNativeNavigationTracker` on every screen change (and on
  initial mount when React Navigation's `getCurrentRoute()` returns a
  name), carrying `screen.name`, `screen.load_time` (seconds), and
  `view.loading_time_ms` (int). Backs the dashboard's per-screen
  Avg/P95 Load Time, Load Time Trend, and Slowest Loads panels.
  Mirrors scout-flutter's `onScreenLoadTime` callback.
  Note: the span is emitted as instantaneous (no OTel `Duration`);
  dashboard queries should read `SpanAttributes['screen.load_time']`
  (multiplied by 1000 for ms) rather than `Duration/1e6`. Explicit
  `startTime`/`endTime` on `emitSpan` triggered an OTel JS quirk that
  silently dropped the span.
- **`Scout.setCurrentScreen(name)` public API.** Lets host code (or the
  built-in route trackers) set the active screen so every subsequent
  span/metric/log carries `screen.name` via `commonAttributes()`.
- **`Scout.setSessionAttributes(attrs)` / `clearSessionAttributes()` API.**
  Integrator-supplied attributes stamped on every span in the current
  session, alongside the `user.*` namespace. Survives session rotations
  until explicitly cleared. Matches scout-flutter v0.1.19.
- **`react_native.cpu.usage` gauge.** Periodic CPU usage sample (every
  10s). Android reads `/proc/<pid>/stat` ticks and computes percentage
  via wall-clock delta; iOS sums `cpu_usage` across all task threads
  via Mach `thread_basic_info`. Disabled by `enableCpuMetrics: false`.
- **Native ANR detection (Android + iOS) with main-thread + JS-thread
  heartbeats.** Android `ScoutAnrWatchdog` runs on a dedicated
  background thread, posts heartbeat runnables to `Looper.getMainLooper()`
  AND tracks a JS-thread heartbeat via `notifyJsAlive()`; on either
  silence past `anrThresholdMs` it captures a full thread dump via
  `ScoutThreadDumpCollector` (`Thread.getAllStackTraces()` capped at
  32 KB / 64 frames per thread) and ships it through a new `ScoutAnr`
  Expo event. iOS uses the existing `AppHangWatchdog`, extended to
  also track the JS heartbeat; captures the main thread's backtrace
  via `ScoutThreadBacktrace` (Mach `thread_suspend` + frame-pointer
  walking + `dladdr()` symbolication, arm64 + x86_64). The `anr` span
  now carries `anr.main_thread_stack`, `anr.threads_json`,
  `anr.thread_count`, `anr.source_thread` (`main` / `js`), plus
  `breadcrumbs`. The `ui_hang` span (iOS) gets
  `ui_hang.main_thread_stack` + breadcrumbs.
- **Resource attrs: `device.orientation`, `device.is_jail_broken`,
  `ndk.build_id`.** Orientation is auto-updated on `Dimensions.change`
  events. Jailbreak/root check runs once at init (root-package +
  binary path probes on Android; Cydia-style path probes on iOS,
  always returns false on the simulator). `ndk.build_id` reads the
  ELF `.note.gnu.build-id` from `libscout_signal_handler.so` so the
  backend can match native crash stacks against the correct stripped
  binary.
- **`device.battery.discharge_rate` runtime attribute.** Sampled every
  60s via `BatteryManager.BATTERY_PROPERTY_CURRENT_NOW` on Android
  (µA); not available on iOS (Flutter doesn't expose this either).
- **`maxTombstoneBytes` config (default `131072`, min `4096`).** Caps
  the size of the `crash.tombstone` attribute on Android `ExitInfo`
  crashes — Android tombstones can be multi-megabyte; this prevents
  span-payload bloat.
- **Diagnostics panel buttons** in the example app: `anr (JS thread, 6s)`,
  `anr (UI thread, 6s)`, `anr (JS thread, 12s long freeze)`,
  `ui_hang (UI thread, 500ms)`, `manual breadcrumb`,
  `log info / warn / error`.
- **Per-emit + per-export debug logs when `debug: true`.** `[scout] emit
  <span> <screen>` for every emitted span and `[scout] <traces|metrics|logs>
  attempt N items=K → OK/FAIL ...` for every export attempt. Helps confirm
  the SDK is actually exporting to the configured endpoint.
- **Native ANR detection with thread dumps (Android).** New
  `ScoutAnrWatchdog` runs on a background `HandlerThread`, posts heartbeat
  runnables to the main `Looper`, and if the main thread doesn't respond
  within the configured threshold (default 5000ms, `anrThresholdMs`
  config) it captures a full thread dump via the new
  `ScoutThreadDumpCollector` (`Thread.getAllStackTraces()` with per-thread
  64-frame cap + 32 KB total cap) and ships it through a new
  `ScoutAnr` Expo event to JS. The `anr` span now carries
  `anr.main_thread_stack`, `anr.threads_json`, `anr.thread_count`, plus
  `breadcrumbs` — previously had only duration + threshold.
  Replaces the prior JS `setInterval` detector (which fired AFTER the
  block ended, so couldn't observe the blocked main thread).
- **Native ANR detection with main-thread backtrace (iOS).** Uses the
  existing `AppHangWatchdog` with a longer threshold for the `anr` tier
  (5000ms by default) and captures the main thread's backtrace via the
  new `ScoutThreadBacktrace` (Mach APIs `thread_suspend` +
  `thread_get_state` + frame-pointer walking + `dladdr()` symbolication —
  arm64 + x86_64). Frames are shipped via a `ScoutAnr` Expo event;
  the span carries `anr.main_thread_stack` + breadcrumbs.
- **`ui_hang.main_thread_stack` on iOS UI hang spans.** Same
  `ScoutThreadBacktrace` capture, attached to the existing `ui_hang`
  span (fired at the lower `iosHangThresholdMs` default 250 ms).
- **`breadcrumbs` attribute on `anr` and `ui_hang` spans.** Was missing
  from both span types; now stamped from `breadcrumbsManager.serialize()`
  at emit time so the trail leading up to the hang is preserved.

### Fixed

- **Every span and metric now carries `screen.name` when a screen is
  active.** Previously, the closure-local `currentScreen` in
  `navigation.ts` / `route.ts` was inaccessible to other instrumentations,
  so `long_task` (1849 affected per dashboard analysis), `user_interaction`
  (126), `http.request` (334), `app_startup` (39), `error` (66),
  `frozen_frame` (186), `ui_hang`, `anr` (153), and `native_crash` spans
  all emitted without screen attribution. Same for `react_native.frame.*`
  metrics. Fixed centrally: `Scout.setCurrentScreen(name)` is called by
  `installNativeNavigationTracker` / `installRouteTracker` on every screen
  transition; `Scout.commonAttributes()` stamps `screen.name` on every
  span/metric/log spread automatically. Mirrors scout-flutter's
  `_currentScreenName` static field pattern.
- **`anr.ts` was reading screen name from `commonAttributes()` which never
  carried it.** The lookup at `(common as any)[ATTR.SCREEN_NAME]` was
  always undefined. Now obsolete — `commonAttributes()` carries it
  natively.

## [0.1.9] - 2026-06-15

### Added

- **RUM telemetry-semantics spec compliance.** Every span now carries
  `session.start_time` (RFC3339+Z, identical for the whole session),
  `session.sample_rate` (the configured rate as a `LowCardinality(String)` for
  ClickHouse rollups), and — on error/crash-class spans bypassed from unsampled
  sessions — `session.sampled = "false"`. Backend distinct counts can now treat
  per-session rows as sampled population while keeping crash counts
  population-complete.
- **`crash.previous_session_id` + `crash.session_started_at` on native crash
  spans.** New `setSessionContext(sessionId, sessionStartIso)` bridge on both
  platforms — wired into the NDK signal handler (Android) and KSCrash userInfo
  (iOS) at init and on every session rotation. On relaunch, the drain code
  emits the crashed session's id/start_time as `crash.previous_session_id` and
  `crash.session_started_at` regardless of relaunch delay, so next-launch
  `native_crash` spans attribute to the correct session.
- **`crash.last_screen` on `app_crash` spans.** Derived from the most recent
  `navigation` breadcrumb at drain time (mirroring the existing `native_crash`
  path), so the JS-side unclean-termination spans surface the screen the user
  was on when the marker last persisted.
- **Resource attrs: `app.bundle_id`, `app.version`, `app.build` (split from
  `service.version`).** `service.version` continues to carry the semver-only
  build; `app.build` carries the build number; `app.bundle_id` carries the
  reverse-DNS identifier. Web falls back to `location.origin` for
  `app.bundle_id`.
- **Resource attrs: `os.name` normalized to `"iOS"` / `"Android"`,
  `host.arch` lowercased** (`arm64`, `amd64`) per OTel semconv; new
  `os.build`, `device.name` resource attrs on both platforms.

### Changed

- **BREAKING (wire format): HTTP semconv migration.** `http.method` →
  `http.request.method`, `http.url` → `url.full`, `http.status_code` →
  `http.response.status_code`, `http.response_content_length` →
  `http.response.body.size`. Matches scout-flutter v0.1.15 and the RUM ClickHouse
  rollup contract.
- **Breadcrumb buffer capacity raised from 20 to 100 entries** so the trail
  surviving a crash carries enough navigation/HTTP/error context for the
  backend's last-screen and journey reconstruction.
- **iOS KSCrash `userInfo` is now a thread-safe merged dict** instead of being
  overwritten on every `setBreadcrumbs` call. Coexisting `scout.breadcrumbs` +
  `scout.session_id` + `scout.session_started_at` keys are preserved across
  push events; the drain falls back to parsing KSCrash's `json_data` envelope
  when the dict exceeds KSCrash's size limit.
- **`app_crash` marker `startedAt` now reads from the session manager** instead
  of the marker-write time. Previously, `crash.started_at` on relaunch was the
  AppState transition time, not the session start — backend joins on
  `(SessionId, SessionStart)` would mis-attribute.

### Removed

- **`Scout.crashNow()`, `Scout.simulateCrash()`, `Scout.setTestApisEnabled()`,
  and the `enableTestApis` config flag.** Test-only crash trigger APIs have no
  place in a production SDK — they're an injection footgun and no commercial
  RUM provider ships them. Apps that want a "force crash" button can implement
  it inline in their dev panel via `throw new Error()` /
  `ErrorUtils.reportFatalError()`. The corresponding native exports
  (`Java_..._simulateCrash`, `ScoutCrashTestApis.crashNow`,
  `ScoutNdkSignalHandler.simulateCrash`) are gone.

### Earlier unreleased additions

- **`maxSessionDurationMinutes`** (default `60`). Caps the lifetime of a session.
  When the lifetime is exceeded the next `sessionId` read rotates to a fresh
  session. Pass `0` to disable the cap.
- **`iosHangThresholdMs`** (default `250`, min `50`, `0` disables). Drives a new
  iOS `AppHangWatchdog` that emits a `ui_hang` span whenever the main thread is
  blocked past the threshold. The span carries `ui_hang.duration` and
  `ui_hang.threshold` (seconds) and bypasses session sampling (it's in
  `ERROR_CLASS_SPANS`). Disabled on Android.
- **`customTargetResolver`** config hook. Lets the host app override how
  `ScoutTouchBoundary` describes a tap target — the resolver receives the
  React fiber/host node and returns `{ elementName, searchForBetter?,
  searchForText? } | null`. Falls back to the existing fiber walk when the
  resolver returns null or asks to search further.
- **Auto-detect `serviceVersion` from the host app.** If `Scout.initialize`
  isn't given a `serviceVersion`, the SDK reads it from `CFBundleShortVersionString`
  / `versionName` (via `react-native-device-info`), falling back to `'1.0.0'`.
- **Breadcrumbs are now persisted into native crash reports.** On iOS the
  serialized trail is written into `KSCrash.userInfo`; on Android it's pushed
  into the JNI signal handler via `nativeSetBreadcrumbs`. Pending native crashes
  emit `crash.breadcrumbs` so the trail survives even when the JS bridge dies.
- **`UI_HANG` span constant** in `src/core/spans.ts`, added to
  `ERROR_CLASS_SPANS` so it bypasses session sampling like other error-class
  spans.
- **Extensive iOS KSCrash field coverage.** New `crash.*` attributes on
  KSCrash reports including `crash.os_build`, `crash.boot_time`,
  `crash.memory_footprint`, `crash.app_transition_state`,
  `crash.termination_flags/code/namespace/indicator/byProc/byPid`,
  `crash.thread_count`, `crash.thread_name`, `crash.diagnosis`,
  `crash.crashing_thread_index`, full `crash.application_stats.*`. Plus
  drain-time context (`crash.idfv`, `crash.uid`, `crash.gid`,
  `crash.system_boot_time_iso`, `crash.time_since_boot_secs`,
  `crash.drain_uptime_secs`, `crash.drain_app_state`, `crash.environment`,
  `crash.build_configuration`) and sysctl-derived context
  (`crash.translated` for Rosetta, `crash.parent_pid`,
  `crash.parent_proc_name`).
- **Android NDK signal handler now bakes in static context.** Static buffers
  populated at init via `ScoutNdkSignalHandler.setContextIfLoaded` and
  `setExtendedContextIfLoaded` emit `crash.device_model`, `crash.os_version`,
  `crash.os_build`, `crash.application_version`, `crash.bundle_id`,
  `crash.app_name`, `crash.build_type`, `crash.device_app_hash`,
  `crash.app_uuid`, `crash.cpu_arch`, `crash.app_in_foreground`, and
  `crash.app_active` directly into the signal-time JSON.

### Earlier unreleased changes

- **BREAKING (wire format): user attributes moved from `enduser.*` to `user.*`
  namespace.** `setUser(id, attrs)` API is unchanged, but emitted keys are now
  `user.id`, `user.anonymous_id`, and `user.<custom>` (auto-prefixed unless the
  caller already prefixed with `user.`). `ATTR.ENDUSER_ID` /
  `ATTR.ENDUSER_ANONYMOUS_ID` constants renamed to `ATTR.USER_ID` /
  `ATTR.USER_ANONYMOUS_ID`. Backend dashboards keyed on `enduser.*` must be
  updated. `account.*` keys unchanged.
- **BREAKING (wire format): MetricKit callstack trees are now base64-encoded.**
  `crash.callstack_tree_json` on `crash.type` `metric_kit` and `metric_kit_hang`
  reports is now the base64 of the raw `MXCallStackTree.jsonRepresentation()`
  bytes rather than truncated UTF-8 plaintext. A companion attribute
  `crash.callstack_tree_encoding = "base64"` flags the new format.
- **Crash payload truncation caps removed.** `crash.registers_json`,
  `crash.callstack_tree_json`, `crash.binary_images_json` (iOS KSCrash) and
  Android `crash.tombstone` from ExitInfo ANR traces now ship full content
  instead of being truncated to 16KB/32KB.

## [0.1.8] - 2026-05-27

### Added

- **Cold and warm `app_startup` spans (native).** A new native
  `getProcessStartTimeMillis` is exposed by `ScoutCrash` on Android and iOS so
  the cold-start duration is measured from the OS process start, not from
  `Scout.initialize`. On background-to-active transitions, a `warm`
  `app_startup` span is emitted with duration measured to the next animation
  frame. Both carry `app.startup.type` (`cold` | `warm`) and
  `app.startup.duration_seconds`.

## [0.1.6] - 2026-05-22

### Changed

- **`sessionSampleRate` default lowered from `100` to `1`** (1% of sessions). Production
  default that bounds telemetry volume; set explicitly to `100` for development. See
  the README "Sampling" section.

### Added

- **`alwaysCaptureErrors` (default `true`)** — error- and crash-class spans (`error`,
  `native_crash`, `app_crash`, `anr`) and `ERROR`-severity logs now bypass
  `sessionSampleRate` and are always exported. Set to `false` to subject errors to
  the same sampling decision as other telemetry.
- `ERROR_CLASS_SPANS` constant exported from `src/core/spans.ts` enumerates the span
  names that participate in the bypass.

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
  `@base-14/scout-react`). Every span, metric, and log emitted by the SDK
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

- **Web entry (`@base-14/scout-react`)** — bundled via tsup, ESM + CJS + d.ts.
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
- **React subpath (`@base-14/scout-react/react`)** — `ScoutProvider`,
  `useScout` hook, `ScoutErrorBoundary`, `ScoutAction` annotation wrapper.
- **Native entry (`@base-14/scout-react/native`)** — compiled via `tsc` (no
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
