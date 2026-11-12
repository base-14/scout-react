import {
  context,
  trace,
  metrics,
  type Tracer,
  type Meter,
  type Span,
  type Histogram,
  type UpDownCounter,
  SpanStatusCode,
} from '@opentelemetry/api';
import { logs, type Logger as OtelLogger } from '@opentelemetry/api-logs';
import { ATTR } from './attributes';
import { isSdkOriginStack } from './sdk-origin';
import { SPAN, BREADCRUMB_TYPE, ERROR_CLASS_SPANS } from './spans';
import { METRIC } from './metrics';
import { applyBeforeSend } from './before-send';
import { BreadcrumbManager } from './breadcrumb-manager';
import {
  SessionManager,
  shouldRotateOnIdentityChange,
  type SamplingSource,
} from './session-manager';
import { UserManager } from './user-manager';
import { SEVERITY_NUMBER } from './logger';
import { resolveConfig, type ResolvedConfig, type ScoutConfig } from './config';
import type { PlatformAdapter } from './platform';
import type { Attributes, AttributeValue, SeverityText } from './types';
import { SCOPE_NAME, SCOPE_VERSION } from './scope';
import { uuidv4 } from './uuid';
import { DisabledPeriods, crashHappenedWhileDisabled } from './disabled-periods';
/**
 * Handle for a span whose lifetime spans an in-flight operation. See
 * {@link Scout.startTrackedSpan}.
 */
export interface TrackedSpan {
  /** The live span. Prefer `end()` over calling `span.end()` directly. */
  span: Span;
  /** W3C `traceparent` value for this span, sampled-flag set. */
  traceparent(): string;
  /** Merges `extra` attributes, applies status, ends the span and records it. */
  end(extra?: Attributes, opts?: { status?: SpanStatusCode }): void;
}
/**
 * Identity and transport a native host hands to a page it embeds. See
 * {@link Scout.setWebViewBridge} for the modes these fields select.
 */
export interface WebViewBridgeOptions {
  /** Host session id the page adopts, so both sides report one session. */
  sessionId?: string;
  /** Host's stable per-install anonymous user id. */
  anonymousId?: string;
  /** Receives a copy of every span the page emits, for the host to re-emit. */
  send?: (payload: Record<string, unknown>) => void;
  /**
   * Stop POSTing spans from the page — the host's `send` becomes the only
   * delivery path. Ignored unless `send` is supplied. Leave unset when the
   * WebView can reach the collector itself; setting it without a working
   * host-side relay silently drops the page's spans.
   */
  relay?: boolean;
  /**
   * The host's sampling decision for the adopted session. When it is
   * supplied, the page follows it, so a host "no" stops the page's spans too.
   * When it is omitted (older hosts), the page is forced sampled, as before.
   */
  sampled?: boolean;
  /** Where the host's decision came from; stamped as `session.sampling_source`. */
  samplingSource?: SamplingSource;
}
/** Storage key for the latest app-supplied per-user sampling value. */
export const USER_SAMPLING_KEY = 'scout.user_sampling';
const MAX_STACK_LEN = 8000;
function errorFingerprint(type: string, message: string, stack: string): string {
  const firstFrame =
    (stack ?? '').split('\n').find((l) => /[\s(]at\s|^\s*at\s/.test(l)) ?? '';
  const seed = `${type}|${message}|${firstFrame.trim()}`;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h) ^ seed.charCodeAt(i);
  }
  let h2 = 52711;
  for (let i = 0; i < seed.length; i++) {
    h2 = ((h2 << 5) + h2) ^ seed.charCodeAt(i);
  }
  const a = (h >>> 0).toString(16).padStart(4, '0').slice(-4);
  const b = (h2 >>> 0).toString(16).padStart(4, '0').slice(-4);
  return `${a}${b}`;
}
function detectSourceType(): string {
  const g: any = globalThis as any;
  if (typeof g.document !== 'undefined') return 'browser';
  if (typeof g.navigator?.product === 'string' && g.navigator.product === 'ReactNative') {
    return 'react-native';
  }
  if (typeof g.HermesInternal !== 'undefined') return 'react-native';
  return 'unknown';
}
function extractErrorCauses(err: unknown): Array<{
  message: string;
  type?: string;
  stack?: string;
  source?: string;
}> {
  const out: Array<{
    message: string;
    type?: string;
    stack?: string;
    source?: string;
  }> = [];
  let cur: any = err && typeof err === 'object' ? (err as any).cause : undefined;
  let depth = 0;
  while (cur && depth < 5) {
    const msg = String(cur.message ?? cur);
    out.push({
      message: msg,
      type: cur.name ? String(cur.name) : undefined,
      stack: cur.stack ? String(cur.stack).slice(0, 2000) : undefined,
      source: 'source',
    });
    cur = cur.cause;
    depth++;
  }
  return out;
}
export class Scout {
  // Instruments are cached rather than re-created per record; the meter
  // dedupes by name, but only after building and matching a descriptor.
  private _histograms = new Map<string, Histogram>();
  private _gauges = new Map<string, UpDownCounter>();
  private _config: ResolvedConfig;
  private platform: PlatformAdapter;
  private tracer: Tracer;
  private meter: Meter;
  private otelLogger: OtelLogger;
  private session: SessionManager;
  private breadcrumbs: BreadcrumbManager;
  private user = new UserManager();
  private errorCounter: ReturnType<Meter['createCounter']> | null = null;
  /** Fingerprints of SDK-internal failures already reported this page. */
  private _sdkErrorFingerprints = new Set<string>();
  private viewCounters: {
    action?: ReturnType<Meter['createCounter']>;
    error?: ReturnType<Meter['createCounter']>;
    crash?: ReturnType<Meter['createCounter']>;
    long_task?: ReturnType<Meter['createCounter']>;
    frozen_frame?: ReturnType<Meter['createCounter']>;
    resource?: ReturnType<Meter['createCounter']>;
    frustration?: ReturnType<Meter['createCounter']>;
  } = {};
  private _connectionType = 'unknown';
  private _rootSpan: Span | null = null;
  private _runtimeAttrs: Attributes = {};
  /** Set once `setUserSampling` runs, so bootstrap hydration never overwrites a newer value. */
  private _userSamplingSetAtRuntime = false;
  /** The runtime kill switch. Read synchronously by every emit path. */
  private _enabled: boolean;
  /** Set once bootstrap has made the session decision; earlier `setEnabled` calls only flip the flag. */
  private _sessionDecided = false;
  /** Serialises enable/disable transitions so they never interleave. */
  private _transition: Promise<void> = Promise.resolve();
  private _enabledListeners: Array<(enabled: boolean) => void | Promise<void>> = [];
  private _disabledPeriods: DisabledPeriods;
  private _breadcrumbsHydrated = false;
  /**
   * Wall-clock start of the process, when the platform knows it. A launch
   * that starts disabled dates its disabled period from here, so a crash
   * before `initialize()` finished is covered too.
   */
  processStartedAtMs: number | null = null;
  constructor(config: ScoutConfig, platform: PlatformAdapter) {
    this._config = resolveConfig(config);
    this.platform = platform;
    this.tracer = trace.getTracer(SCOPE_NAME, SCOPE_VERSION);
    this.meter = metrics.getMeter(SCOPE_NAME, SCOPE_VERSION);
    this.otelLogger = logs.getLogger(SCOPE_NAME, SCOPE_VERSION);
    this.session = new SessionManager(platform, {
      timeoutMinutes: this._config.sessionTimeoutMinutes,
      sampleRate: this._config.sessionSampleRate,
      maxDurationMinutes: this._config.maxSessionDurationMinutes,
    });
    this.breadcrumbs = new BreadcrumbManager(platform);
    this._enabled = this._config.enabled;
    this.breadcrumbs.setPaused(!this._enabled);
    this._disabledPeriods = new DisabledPeriods(platform);
  }
  async bootstrap(): Promise<void> {
    // The decision for a new session is made inside session.start(), so the
    // pending per-user value must be in memory before it runs.
    await this.hydrateUserSampling();
    await this._disabledPeriods.load();
    this._sessionDecided = true;
    const decided = this.applyInitialEnabledState();
    this._transition = decided.catch(() => {});
    await decided;
    try {
      const KEY = 'scout.anonymous_id';
      let stored = await this.platform.getItem(KEY);
      if (!stored) {
        const fresh = (await import('./uuid')).uuidv4();
        await this.platform.setItem(KEY, fresh);
        stored = fresh;
      }
      this._anonymousId = stored;
    } catch {}
    if (this._config.enablePerformanceMetrics || this._config.enableErrorTracking) {
      try {
        this.errorCounter = this.meter.createCounter(METRIC.ERROR_COUNT, {
          description: 'Count of errors observed by Scout',
        });
      } catch {}
    }
    try {
      this.viewCounters.action = this.meter.createCounter(METRIC.VIEW_ACTION_COUNT, {
        description: 'Count of user_interaction spans on this view',
      });
      this.viewCounters.error = this.meter.createCounter(METRIC.VIEW_ERROR_COUNT, {
        description: 'Count of error spans on this view',
      });
      this.viewCounters.crash = this.meter.createCounter(METRIC.VIEW_CRASH_COUNT, {
        description: 'Count of app_crash / native_crash spans on this view',
      });
      this.viewCounters.long_task = this.meter.createCounter(
        METRIC.VIEW_LONG_TASK_COUNT,
        {
          description: 'Count of long_task spans on this view',
        },
      );
      this.viewCounters.frozen_frame = this.meter.createCounter(
        METRIC.VIEW_FROZEN_FRAME_COUNT,
        { description: 'Count of frozen_frame spans on this view' },
      );
      this.viewCounters.resource = this.meter.createCounter(METRIC.VIEW_RESOURCE_COUNT, {
        description: 'Count of http.request spans on this view',
      });
      this.viewCounters.frustration = this.meter.createCounter(
        METRIC.VIEW_FRUSTRATION_COUNT,
        { description: 'Count of frustration-flagged interactions on this view' },
      );
    } catch {}
    this._connectionType = this.platform.getConnectionType();
    if (this._config.enableConnectivityTracking && this.platform.onConnectivityChange) {
      this.platform.onConnectivityChange((t) => {
        this._connectionType = t;
      });
    }
  }
  get config(): ResolvedConfig {
    return this._config;
  }
  /**
   * Enabled: resume-or-create, exactly as before the switch existed. Disabled:
   * no session is read, created or touched, and the persisted one is left as
   * it was; the previous session's breadcrumbs stay persisted for a later
   * enabled launch's crash report.
   */
  private async applyInitialEnabledState(): Promise<void> {
    if (this._enabled) {
      await this.session.start();
      await this.hydrateBreadcrumbs();
      return;
    }
    this.session.suspend();
    await this._disabledPeriods.open(this.processStartedAtMs ?? Date.now());
    this.debug('enabled=false at init: no session, nothing is exported');
  }
  private async hydrateBreadcrumbs(): Promise<void> {
    if (this._breadcrumbsHydrated) return;
    this._breadcrumbsHydrated = true;
    await this.breadcrumbs.hydrate();
  }
  /** Whether RUM is running. While false nothing is created, buffered or exported. */
  get enabled(): boolean {
    return this._enabled;
  }
  /**
   * The runtime kill switch. Disabling flushes what was recorded while
   * enabled (via the listeners), then ends the session; from that moment every
   * signal is dropped, errors included. Enabling always starts a fresh session,
   * sampled like any new one. Repeating the current value is a no-op.
   *
   * Before bootstrap has decided the first session, this only changes the
   * value that decision uses. The returned promise settles once the
   * transition (flush, session change) has finished.
   */
  setEnabled(value: boolean): Promise<void> {
    if (typeof value !== 'boolean' || value === this._enabled) return this._transition;
    this._enabled = value;
    this.breadcrumbs.setPaused(!value);
    if (!this._sessionDecided) {
      this.debug('enabled', value, '(applies at init)');
      return Promise.resolve();
    }
    this.debug('enabled', value);
    const at = Date.now();
    const step = value ? () => this.enableNow(at) : () => this.disableNow(at);
    this._transition = this._transition.then(step, step).catch((e) => {
      this.debug('setEnabled transition failed', e);
    });
    return this._transition;
  }
  /**
   * Registers a callback run on every enable/disable transition. On disable it
   * runs before the session ends, and a returned promise is awaited, which is
   * how the exporters get flushed before they close. On enable it runs after
   * the fresh session has started. Returns an unsubscribe function.
   */
  onEnabledChange(listener: (enabled: boolean) => void | Promise<void>): () => void {
    this._enabledListeners.push(listener);
    return () => {
      const i = this._enabledListeners.indexOf(listener);
      if (i >= 0) this._enabledListeners.splice(i, 1);
    };
  }
  private async notifyEnabledListeners(enabled: boolean): Promise<void> {
    await Promise.allSettled(this._enabledListeners.slice().map(async (l) => l(enabled)));
  }
  private async disableNow(at: number): Promise<void> {
    // Recorded first: a crash during the flush below is already "while disabled".
    await this._disabledPeriods.open(at);
    // Started while enabled, ending after the disable: dropped, not reported.
    this._activeVitals.clear();
    this._rootSpan = null;
    await this.notifyEnabledListeners(false);
    await this.session.end();
  }
  private async enableNow(at: number): Promise<void> {
    await this._disabledPeriods.close(at);
    await this.hydrateBreadcrumbs();
    const id = await this.session.resume();
    this.debug('enabled: new session', id);
    await this.notifyEnabledListeners(true);
  }
  /**
   * Whether a pending native crash report was written while RUM was disabled
   * (this process or an earlier one). Such a report is dropped, never replayed.
   */
  crashHappenedWhileDisabled(report: Record<string, unknown>): boolean {
    return crashHappenedWhileDisabled(report, this._disabledPeriods);
  }
  /**
   * Resolves the per-user value in effect at launch: `init ?? stored ?? null`.
   * A non-null init value is persisted, while a null init value means "no
   * opinion" and keeps the stored one. A `setUserSampling` call that arrived
   * before bootstrap wins over both.
   */
  private async hydrateUserSampling(): Promise<void> {
    if (this._userSamplingSetAtRuntime) return;
    const init = this._config.userSampling;
    if (init !== null) {
      this.session.setPendingUserSampling(init);
      await this.persistUserSampling(init);
      return;
    }
    let stored: boolean | null = null;
    try {
      const raw = await this.platform.getItem(USER_SAMPLING_KEY);
      stored = raw === 'true' ? true : raw === 'false' ? false : null;
    } catch {}
    if (!this._userSamplingSetAtRuntime) this.session.setPendingUserSampling(stored);
  }
  private async persistUserSampling(value: boolean | null): Promise<void> {
    try {
      if (value === null) await this.platform.removeItem(USER_SAMPLING_KEY);
      else await this.platform.setItem(USER_SAMPLING_KEY, String(value));
    } catch {}
  }
  /**
   * Per-user sampling decided by your app, typically from its remote config.
   * `true` keeps this user's sessions, `false` drops their spans (logs and
   * metrics still flow), and `null` falls back to `sessionSampleRate`. The
   * value applies from the next session start and never changes the current
   * session. It is persisted, so the next launch honours it too.
   */
  setUserSampling(value: boolean | null): void {
    const v = typeof value === 'boolean' ? value : null;
    this._userSamplingSetAtRuntime = true;
    this.session.setPendingUserSampling(v);
    void this.persistUserSampling(v);
    this.debug('userSampling', v, '(applies at next session start)');
  }
  /** The latest app-supplied per-user value; `null` means none. */
  get userSampling(): boolean | null {
    return this.session.pendingUserSamplingValue;
  }
  private rotateIfUserChanged(previous: string | null, next: string | null): void {
    // While disabled there is no session to rotate; the next enable starts a
    // fresh one for whoever the user is by then.
    if (this.session.isSuspended) return;
    const rotate = shouldRotateOnIdentityChange(
      previous,
      next,
      this.session.samplingSource,
      this.session.pendingUserSamplingValue,
    );
    if (rotate) void this.session.rotate();
  }
  get sessionId(): string | null {
    return this.session.sessionId;
  }
  get userId(): string | null {
    return this.user.id;
  }
  get userAttributes(): Readonly<Attributes> {
    return this.user.attributes;
  }
  get anonymousId(): string | null {
    return this._anonymousId;
  }
  get connectionType(): string {
    return this._connectionType;
  }
  get otelTracer(): Tracer {
    return this.tracer;
  }
  get otelMeter(): Meter {
    return this.meter;
  }
  get breadcrumbsManager(): BreadcrumbManager {
    return this.breadcrumbs;
  }
  get sessionManager(): SessionManager {
    return this.session;
  }
  get platformAdapter(): PlatformAdapter {
    return this.platform;
  }
  get rootSpan(): Span | null {
    return this._rootSpan;
  }
  setRootSpan(
    span: Span | null,
    opts: {
      endPrevious?: boolean;
    } = {},
  ): void {
    const { endPrevious = true } = opts;
    if (endPrevious && this._rootSpan && this._rootSpan !== span) {
      try {
        this._rootSpan.end();
      } catch {}
    }
    this._rootSpan = span;
    if (span) this._viewStartedAt = performance.now();
  }
  startRootSpan(name: string, attributes: Attributes = {}): Span | null {
    if (!this._enabled) return null;
    const bypassForErrors =
      this._config.alwaysCaptureErrors && ERROR_CLASS_SPANS.has(name);
    if (!bypassForErrors && !this.session.isSampled) return null;
    const span = this.tracer.startSpan(name, {
      attributes: toOtelAttrs({ ...attributes, ...this.commonAttributes() }),
    });
    this.setRootSpan(span);
    return span;
  }
  private readonly _appStartedAt = Date.now();
  private _lastInteractionAt: number = 0;
  private _lastInteractionScreen: string | null = null;
  private _currentScreen: string | null = null;
  setCurrentScreen(name: string | null): void {
    this._currentScreen = name && name.length > 0 ? name : null;
  }
  get currentScreen(): string | null {
    return this._currentScreen;
  }
  markInteraction(screen?: string | null): void {
    this._lastInteractionAt = Date.now();
    this._lastInteractionScreen = screen ?? this._lastInteractionScreen;
  }
  consumeInteractionForInv(maxWindowMs: number = 5000): {
    at: number;
    fromScreen: string | null;
  } | null {
    if (this._lastInteractionAt === 0) return null;
    const age = Date.now() - this._lastInteractionAt;
    if (age > maxWindowMs) return null;
    const out = { at: this._lastInteractionAt, fromScreen: this._lastInteractionScreen };
    this._lastInteractionAt = 0;
    this._lastInteractionScreen = null;
    return out;
  }
  commonAttributes(): Attributes {
    const attrs: Attributes = {
      [ATTR.SESSION_TYPE]: 'user',
      [ATTR.SESSION_SAMPLE_RATE]: String(this.session.configuredSampleRate),
      ...this._runtimeAttrs,
    };
    const source = this.session.samplingSource;
    if (source) attrs[ATTR.SESSION_SAMPLING_SOURCE] = source;
    const sid = this.session.sessionId;
    if (sid) attrs[ATTR.SESSION_ID] = sid;
    const startIso = this.session.startedAtIso;
    if (startIso) attrs[ATTR.SESSION_START_TIME] = startIso;
    if (this._currentScreen) attrs[ATTR.SCREEN_NAME] = this._currentScreen;
    for (const [k, v] of Object.entries(this._sessionAttrs)) {
      attrs[k] = v;
    }
    const uid = this.user.id;
    if (uid) attrs[ATTR.USER_ID] = uid;
    for (const [k, v] of Object.entries(this.user.attributes)) {
      attrs[k.startsWith('user.') ? k : `user.${k}`] = v;
    }
    if (this._config.enableConnectivityTracking) {
      if (this._connectionType && this._connectionType !== 'unknown') {
        attrs[ATTR.NETWORK_CONNECTION_TYPE] = this._connectionType;
      }
      const quality = this.platform.getNetworkQuality?.();
      if (quality?.effectiveType) {
        attrs[ATTR.NETWORK_CONNECTION_EFFECTIVE_TYPE] = quality.effectiveType;
      }
      if (typeof quality?.rttMs === 'number') {
        attrs[ATTR.NETWORK_CONNECTION_RTT_MS] = quality.rttMs;
      }
      if (typeof quality?.downlinkMbps === 'number') {
        attrs[ATTR.NETWORK_CONNECTION_DOWNLINK_MBPS] = quality.downlinkMbps;
      }
    }
    const anon = this._anonymousId;
    if (anon) attrs[ATTR.USER_ANONYMOUS_ID] = anon;
    return attrs;
  }
  /**
   * The subset of `commonAttributes()` that is safe as a metric dimension.
   *
   * Metric attributes are not span attributes. `otel_metrics_histogram` is
   * ORDER BY (ServiceName, MetricName, Attributes, TimeUnix), so every distinct
   * combination is its own time series, kept longer than traces and far harder
   * to delete selectively. That rules out `user.id` and the caller-supplied
   * `user.*` / runtime / session attribute bags, which are unbounded and, in
   * `user.id`'s case, routinely an email address.
   *
   * `session.id` stays: it is bounded per session and dashboards filter on it.
   */
  metricAttributes(): Attributes {
    const attrs: Attributes = {
      [ATTR.SESSION_TYPE]: 'user',
      [ATTR.SESSION_SAMPLE_RATE]: String(this.session.configuredSampleRate),
    };
    const source = this.session.samplingSource;
    if (source) attrs[ATTR.SESSION_SAMPLING_SOURCE] = source;
    const sid = this.session.sessionId;
    if (sid) attrs[ATTR.SESSION_ID] = sid;
    if (this._currentScreen) attrs[ATTR.SCREEN_NAME] = this._currentScreen;
    return attrs;
  }
  private _anonymousId: string | null = null;
  private _webViewBridgeSend?: (payload: Record<string, unknown>) => void;
  /**
   * Adopts a native host's RUM identity so an embedded WebView and the app
   * around it report as one session instead of two disconnected ones.
   *
   * Every field is optional, and the useful modes come from which ones you
   * pass:
   *
   * - **Session adoption only** (`sessionId` + `anonymousId`, no `send`) —
   *   the page keeps exporting to the collector itself, tagged with the
   *   host's session. One copy of every signal, full fidelity. This is the
   *   recommended default whenever the WebView can reach the collector.
   * - **Relay** (`send` + `relay: true`) — the page stops POSTing spans and
   *   hands them to the host instead. Use when the WebView cannot reach the
   *   collector directly. Note that only spans travel the bridge: logs and
   *   metrics keep exporting over HTTP, because the host-side re-emit
   *   accepts spans only.
   * - **Mirror** (`send`, `relay` false/omitted) — the page exports *and*
   *   hands a copy to the host. Both copies reach the backend, so expect
   *   duplicate spans. Opt into this only when you want the host to observe
   *   web events locally.
   */
  setWebViewBridge(bridge: WebViewBridgeOptions): void {
    if (typeof bridge?.sessionId === 'string' && bridge.sessionId) {
      this.session.adoptExternalSessionId(bridge.sessionId, {
        sampled: bridge.sampled,
        samplingSource: bridge.samplingSource,
      });
    }
    if (typeof bridge?.anonymousId === 'string' && bridge.anonymousId) {
      this._anonymousId = bridge.anonymousId;
    }
    if (typeof bridge?.send === 'function') {
      this._webViewBridgeSend = bridge.send;
    }
  }
  /** Whether a host has taken over span delivery for this page. */
  static isRelaying(bridge: WebViewBridgeOptions): boolean {
    return bridge?.relay === true && typeof bridge?.send === 'function';
  }
  timeSinceAppStartMs(): number {
    return Date.now() - this._appStartedAt;
  }
  setRuntimeAttribute(key: string, value: AttributeValue | null | undefined): void {
    if (value == null) {
      delete this._runtimeAttrs[key];
    } else {
      this._runtimeAttrs[key] = value;
    }
  }
  logEvent(name: string, attributes?: Attributes): void {
    this.emitSpan(name, { ...(attributes ?? {}), ...this.commonAttributes() });
  }
  addBreadcrumb(type: string, message: string): void {
    // The manager itself drops crumbs while disabled.
    this.breadcrumbs.add(type, message);
  }
  setSessionAttributes(attrs: Attributes): void {
    this._sessionAttrs = { ...attrs };
  }
  clearSessionAttributes(): void {
    this._sessionAttrs = {};
  }
  private _sessionAttrs: Attributes = {};
  private _viewStartedAt = performance.now();
  private _activeVitals = new Map<
    string,
    {
      startedAt: number;
      description?: string;
    }
  >();
  private _featureFlags: Record<string, unknown> = {};
  private _accountId: string | null = null;
  private _accountName: string | null = null;
  addTiming(name: string): void {
    const elapsed = performance.now() - this._viewStartedAt;
    this.emitSpan(SPAN.CUSTOM_TIMING, {
      [ATTR.TIMING_NAME]: name,
      [ATTR.TIMING_DURATION_MS]: elapsed,
      ...this.commonAttributes(),
    });
    try {
      this._rootSpan?.setAttribute(`view.custom_timings.${name}`, elapsed);
    } catch {}
  }
  startVital(name: string, description?: string): void {
    if (!this._enabled) return;
    this._activeVitals.set(name, { startedAt: performance.now(), description });
  }
  endVital(name: string): void {
    const v = this._activeVitals.get(name);
    if (!v) return;
    this._activeVitals.delete(name);
    const durationMs = performance.now() - v.startedAt;
    const attrs: Attributes = {
      [ATTR.VITAL_NAME]: name,
      [ATTR.VITAL_TYPE]: 'duration',
      [ATTR.VITAL_DURATION]: durationMs / 1000,
      [ATTR.VITAL_DURATION_MS]: durationMs,
      ...this.commonAttributes(),
    };
    if (v.description) attrs[ATTR.VITAL_DESCRIPTION] = v.description;
    this.emitSpan(SPAN.APP_VITAL, attrs);
  }
  recordOperationStep(
    name: string,
    stepType: 'start' | 'update' | 'retry' | 'end',
    opts?: {
      key?: string;
      failureReason?: 'error' | 'abandoned' | 'other';
    },
  ): void {
    const attrs: Attributes = {
      [ATTR.OPERATION_NAME]: name,
      [ATTR.OPERATION_STEP_TYPE]: stepType,
      [ATTR.VITAL_TYPE]: 'operation_step',
      ...this.commonAttributes(),
    };
    if (opts?.key) attrs[ATTR.OPERATION_KEY] = opts.key;
    if (opts?.failureReason) attrs[ATTR.OPERATION_FAILURE_REASON] = opts.failureReason;
    this.emitSpan(SPAN.OPERATION_STEP, attrs);
  }
  setFeatureFlag(name: string, value: AttributeValue): void {
    this._featureFlags[name] = value;
    this.setRuntimeAttribute(`feature_flag.${name}`, value);
  }
  clearFeatureFlags(): void {
    for (const k of Object.keys(this._featureFlags)) {
      this.setRuntimeAttribute(`feature_flag.${k}`, null);
    }
    this._featureFlags = {};
  }
  setAccount(id: string, name?: string): void {
    this._accountId = id;
    this._accountName = name ?? null;
    this.setRuntimeAttribute(ATTR.ACCOUNT_ID, id);
    if (name) this.setRuntimeAttribute(ATTR.ACCOUNT_NAME, name);
  }
  clearAccount(): void {
    this._accountId = null;
    this._accountName = null;
    this.setRuntimeAttribute(ATTR.ACCOUNT_ID, null);
    this.setRuntimeAttribute(ATTR.ACCOUNT_NAME, null);
  }
  get accountId(): string | null {
    return this._accountId;
  }
  get accountName(): string | null {
    return this._accountName;
  }
  get featureFlags(): Readonly<Record<string, unknown>> {
    return this._featureFlags;
  }
  reportError(
    error: unknown,
    opts?: {
      handled?: boolean;
      library?: string;
      componentStack?: string;
      fingerprint?: string;
      source?: string;
      category?: string;
    },
  ): void {
    // The kill switch outranks alwaysCaptureErrors.
    if (!this._enabled) return;
    const handled = opts?.handled ?? true;
    const { message, stack } = normalizeError(error);
    const truncated = !!(stack && stack.length > MAX_STACK_LEN);
    const attrs: Attributes = {
      [ATTR.ERROR_ID]: uuidv4(),
      [ATTR.ERROR_TYPE]: 'manual_error',
      [ATTR.ERROR_MESSAGE]: message,
      [ATTR.ERROR_STACK_TRACE]: truncated ? stack.slice(0, MAX_STACK_LEN) : stack,
      [ATTR.ERROR_WAS_TRUNCATED]: truncated,
      [ATTR.ERROR_HANDLED]: String(handled),
      [ATTR.ERROR_HANDLING]: handled ? 'handled' : 'unhandled',
      [ATTR.ERROR_SOURCE]: opts?.source ?? 'source',
      [ATTR.ERROR_SOURCE_TYPE]: detectSourceType(),
      [ATTR.ERROR_ORIGIN]: 'app',
      [ATTR.ERROR_TIME_SINCE_APP_START_MS]: this.timeSinceAppStartMs(),
      [ATTR.BREADCRUMBS]: this.breadcrumbs.serialize(),
      ...this.commonAttributes(),
    };
    if (opts?.library) attrs[ATTR.ERROR_LIBRARY] = opts.library;
    if (opts?.componentStack) attrs[ATTR.ERROR_COMPONENT_STACK] = opts.componentStack;
    attrs[ATTR.ERROR_FINGERPRINT] =
      opts?.fingerprint ?? errorFingerprint('manual_error', message, stack);
    if (opts?.category) attrs[ATTR.ERROR_CATEGORY] = opts.category;
    const causes = extractErrorCauses(error);
    if (causes.length > 0) {
      attrs[ATTR.ERROR_CAUSES_JSON] = JSON.stringify(causes).slice(0, 4000);
    }
    try {
      const handling = new Error('handling-stack').stack ?? '';
      attrs[ATTR.ERROR_HANDLING_STACK] = handling.slice(0, 2000);
    } catch {}
    this.emitSpan(SPAN.ERROR, attrs, { status: SpanStatusCode.ERROR });
    this.errorCounter?.add(1, { handled: String(handled) });
    this.breadcrumbs.add(BREADCRUMB_TYPE.ERROR, `manual_error: ${runtimeTypeOf(error)}`);
  }
  reportUncaught(error: unknown): void {
    if (!this._enabled) return;
    const { message, stack } = normalizeError(error);
    const fingerprint = errorFingerprint('uncaught_error', message, stack);
    // A failure inside our own bundle (web-vitals' `Array.prototype.at` on Chrome < 92,
    // say) is not the application breaking: it is recorded so we can see it,
    // but flagged, kept out of the error counters, and reported once per
    // distinct failure — that observer re-threw on every layout shift.
    const sdkOrigin = isSdkOriginStack(stack);
    if (sdkOrigin) {
      if (this._sdkErrorFingerprints.has(fingerprint)) return;
      this._sdkErrorFingerprints.add(fingerprint);
    }
    const truncated = !!(stack && stack.length > MAX_STACK_LEN);
    const attrs: Attributes = {
      [ATTR.ERROR_ID]: uuidv4(),
      [ATTR.ERROR_TYPE]: 'uncaught_error',
      [ATTR.ERROR_MESSAGE]: message,
      [ATTR.ERROR_STACK_TRACE]: truncated ? stack.slice(0, MAX_STACK_LEN) : stack,
      [ATTR.ERROR_WAS_TRUNCATED]: truncated,
      [ATTR.ERROR_HANDLED]: 'false',
      [ATTR.ERROR_HANDLING]: 'unhandled',
      [ATTR.ERROR_SOURCE]: 'source',
      [ATTR.ERROR_SOURCE_TYPE]: detectSourceType(),
      [ATTR.ERROR_ORIGIN]: sdkOrigin ? 'sdk' : 'app',
      [ATTR.ERROR_TIME_SINCE_APP_START_MS]: this.timeSinceAppStartMs(),
      [ATTR.BREADCRUMBS]: this.breadcrumbs.serialize(),
      ...this.commonAttributes(),
    };
    if (sdkOrigin) attrs[ATTR.ERROR_CATEGORY] = 'sdk_internal';
    const causes = extractErrorCauses(error);
    if (causes.length > 0) {
      attrs[ATTR.ERROR_CAUSES_JSON] = JSON.stringify(causes).slice(0, 4000);
    }
    attrs[ATTR.ERROR_FINGERPRINT] = fingerprint;
    this.emitSpan(SPAN.ERROR, attrs, { status: SpanStatusCode.ERROR });
    if (!sdkOrigin) this.errorCounter?.add(1, { handled: 'false' });
    this.breadcrumbs.add(
      BREADCRUMB_TYPE.ERROR,
      `uncaught_error: ${runtimeTypeOf(error)}`,
    );
  }
  /**
   * Sets the current user. Switching from one id to a different id starts a
   * new session while user sampling is in play, so the new user never
   * inherits the previous user's sampling decision. On an account switch,
   * call `setUserSampling(newValue)` before `setUser(newId)`.
   */
  setUser(id: string, attributes?: Attributes): void {
    const previous = this.user.id;
    this.user.set(id, attributes);
    this.rotateIfUserChanged(previous, this.user.id);
  }
  /** Clears the user and the per-user sampling value. Starts a new session if user sampling was in play. */
  clearUser(): void {
    const previous = this.user.id;
    this.user.clear();
    this.setUserSampling(null);
    this.rotateIfUserChanged(previous, null);
  }
  logDebug(message: string, opts?: LogOpts | Attributes): void {
    this.emitLog('DEBUG', message, mergeLogAttrs(opts));
  }
  logInfo(message: string, opts?: LogOpts | Attributes): void {
    this.emitLog('INFO', message, mergeLogAttrs(opts));
  }
  logWarning(message: string, opts?: LogOpts | Attributes): void {
    this.emitLog('WARN', message, mergeLogAttrs(opts));
  }
  logError(message: string, opts?: LogOpts | Attributes): void {
    this.emitLog('ERROR', message, mergeLogAttrs(opts));
  }
  emitSpan(
    name: string,
    attributes: Attributes,
    opts: {
      status?: SpanStatusCode;
      startTime?: number;
      endTime?: number;
      forceSample?: boolean;
    } = {},
  ): Span | null {
    // Before every bypass: neither forceSample nor alwaysCaptureErrors
    // overrides the kill switch.
    if (!this._enabled) return null;
    const bypassForErrors =
      this._config.alwaysCaptureErrors && ERROR_CLASS_SPANS.has(name);
    if (!opts.forceSample && !bypassForErrors && !this.session.isSampled) {
      return null;
    }
    if (bypassForErrors && !this.session.isSampled) {
      attributes = { ...attributes, [ATTR.SESSION_SAMPLED]: 'false' };
    }
    const filtered = applyBeforeSend(this._config.beforeSend, 'span', name, attributes);
    if (!filtered) return null;
    let span: Span;
    try {
      const parentCtx =
        this._rootSpan && this._rootSpan !== this._rootSpanSentinel
          ? trace.setSpan(context.active(), this._rootSpan)
          : context.active();
      span = this.tracer.startSpan(
        name,
        {
          startTime: opts.startTime,
          attributes: toOtelAttrs(filtered.attributes),
        },
        parentCtx,
      );
    } catch (e) {
      this.debug('emitSpan failed', e);
      return null;
    }
    if (opts.status === SpanStatusCode.ERROR) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.end(opts.endTime);
    this.debug('emit', name, filtered.attributes[ATTR.SCREEN_NAME] ?? '(no-screen)');
    this.session.touch();
    this.bumpViewCounter(name, filtered.attributes);
    if (this._webViewBridgeSend) {
      try {
        this._webViewBridgeSend({
          type: name,
          attributes: filtered.attributes,
          timestamp_ms: Date.now(),
        });
      } catch {}
    }
    return span;
  }
  /**
   * Starts a span the caller ends later, with the same `beforeSend` filtering,
   * sampling and view-counter bookkeeping `emitSpan` applies.
   *
   * `emitSpan` creates and ends a span in one call, so it cannot serve callers
   * that need the span's ids *before* the work finishes. W3C trace context is
   * the motivating case: `traceparent` must go out with the request, while the
   * status and duration are only known once it comes back.
   *
   * Returns null when the span is sampled out or dropped by `beforeSend` — and
   * that null is meaningful: callers must not inject a `traceparent` for a span
   * that will never be exported, or the backend sees a dangling parent.
   */
  startTrackedSpan(name: string, attributes: Attributes = {}): TrackedSpan | null {
    if (!this._enabled || !this.session.isSampled) return null;
    const filtered = applyBeforeSend(this._config.beforeSend, 'span', name, attributes);
    if (!filtered) return null;
    let span: Span;
    try {
      const parentCtx =
        this._rootSpan && this._rootSpan !== this._rootSpanSentinel
          ? trace.setSpan(context.active(), this._rootSpan)
          : context.active();
      span = this.tracer.startSpan(
        name,
        { attributes: toOtelAttrs(filtered.attributes) },
        parentCtx,
      );
    } catch (e) {
      this.debug('startTrackedSpan failed', e);
      return null;
    }
    const recorded: Attributes = { ...filtered.attributes };
    return {
      span,
      traceparent: () => {
        const ctx = span.spanContext();
        return `00-${ctx.traceId}-${ctx.spanId}-01`;
      },
      end: (extra, opts) => {
        try {
          if (extra) {
            Object.assign(recorded, extra);
            span.setAttributes(toOtelAttrs(extra));
          }
          if (opts?.status === SpanStatusCode.ERROR) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          span.end();
          // Disabled since it started: the span processor drops it, and
          // nothing here may touch the session or the bridge.
          if (!this._enabled) return;
          this.debug('emit', name, recorded[ATTR.SCREEN_NAME] ?? '(no-screen)');
          this.session.touch();
          this.bumpViewCounter(name, recorded);
          if (this._webViewBridgeSend) {
            this._webViewBridgeSend({
              type: name,
              attributes: recorded,
              timestamp_ms: Date.now(),
            });
          }
        } catch (e) {
          this.debug('startTrackedSpan end failed', e);
        }
      },
    };
  }
  private bumpViewCounter(spanName: string, attributes: Attributes): void {
    const screen = attributes[ATTR.SCREEN_NAME] ?? this._runtimeAttrs[ATTR.SCREEN_NAME];
    const dims: Record<string, string> = {};
    if (typeof screen === 'string' && screen) dims[ATTR.SCREEN_NAME] = screen;
    try {
      switch (spanName) {
        case SPAN.USER_INTERACTION:
          this.viewCounters.action?.add(1, dims);
          if (attributes[ATTR.USER_INTERACTION_FRUSTRATION_TYPE] != null) {
            this.viewCounters.frustration?.add(1, dims);
          }
          break;
        // A frustration describes an interaction that was already counted;
        // counting it again is what inflated view.action.count by one for
        // every frustrated click.
        case SPAN.USER_FRUSTRATION:
          this.viewCounters.frustration?.add(1, dims);
          break;
        case SPAN.ERROR:
          // An SDK-internal failure is visible as a span but is not the
          // view's error.
          if (attributes[ATTR.ERROR_ORIGIN] !== 'sdk')
            this.viewCounters.error?.add(1, dims);
          break;
        case SPAN.APP_CRASH:
        case SPAN.NATIVE_CRASH:
          this.viewCounters.crash?.add(1, dims);
          break;
        case SPAN.LONG_TASK:
          this.viewCounters.long_task?.add(1, dims);
          break;
        case SPAN.FROZEN_FRAME:
          this.viewCounters.frozen_frame?.add(1, dims);
          break;
        case SPAN.HTTP_REQUEST:
          this.viewCounters.resource?.add(1, dims);
          break;
      }
    } catch {}
  }
  private _rootSpanSentinel: Span | null = null;
  withSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => T): T {
    const span = this.tracer.startSpan(name, {
      attributes: toOtelAttrs({ ...attributes, ...this.commonAttributes() }),
    });
    const ctx = trace.setSpan(context.active(), span);
    return context.with(ctx, () => fn(span));
  }
  startChildSpan(name: string, attributes: Attributes = {}): Span | null {
    if (!this._enabled || !this.session.isSampled) return null;
    try {
      const parentCtx = this._rootSpan
        ? trace.setSpan(context.active(), this._rootSpan)
        : context.active();
      return this.tracer.startSpan(
        name,
        { attributes: toOtelAttrs(attributes) },
        parentCtx,
      );
    } catch (e) {
      this.debug('startChildSpan failed', e);
      return null;
    }
  }
  emitHistogram(name: string, value: number, attrs: Attributes = {}): void {
    if (!this._enabled || !this.session.allowsLogsAndMetrics) return;
    const filtered = applyBeforeSend(this._config.beforeSend, 'metric', name, {
      ...attrs,
      ...this.metricAttributes(),
      value,
    });
    if (!filtered) return;
    try {
      let histogram = this._histograms.get(name);
      if (!histogram) {
        histogram = this.meter.createHistogram(name);
        this._histograms.set(name, histogram);
      }
      const recordAttrs = { ...filtered.attributes };
      delete recordAttrs.value;
      histogram.record(value, toOtelAttrs(recordAttrs));
    } catch (e) {
      this.debug('emitHistogram failed', e);
    }
  }
  emitGauge(name: string, value: number, attrs: Attributes = {}): void {
    if (!this._enabled || !this.session.allowsLogsAndMetrics) return;
    const filtered = applyBeforeSend(this._config.beforeSend, 'metric', name, {
      ...attrs,
      ...this.metricAttributes(),
      value,
    });
    if (!filtered) return;
    try {
      let gauge = this._gauges.get(name);
      if (!gauge) {
        gauge = this.meter.createUpDownCounter(name);
        this._gauges.set(name, gauge);
      }
      const recordAttrs = { ...filtered.attributes };
      delete recordAttrs.value;
      gauge.add(value, toOtelAttrs(recordAttrs));
    } catch (e) {
      this.debug('emitGauge failed', e);
    }
  }
  emitLog(
    severity: SeverityText,
    message: string,
    attributes?: Attributes,
    opts: {
      forceSample?: boolean;
    } = {},
  ): void {
    if (!this._enabled || !this._config.enableLogging) return;
    const bypassForErrors = this._config.alwaysCaptureErrors && severity === 'ERROR';
    if (!opts.forceSample && !bypassForErrors && !this.session.allowsLogsAndMetrics) {
      return;
    }
    const base: Attributes = {
      ...this.commonAttributes(),
      ...(this.session.isSampled ? {} : { [ATTR.SESSION_SAMPLED]: 'false' }),
      ...(attributes ?? {}),
    };
    const filtered = applyBeforeSend(this._config.beforeSend, 'log', 'log', base, {
      severity,
      message,
    });
    if (!filtered) return;
    try {
      const activeSpan = this._rootSpan
        ? trace.setSpan(context.active(), this._rootSpan)
        : context.active();
      this.otelLogger.emit({
        severityNumber: SEVERITY_NUMBER[severity],
        severityText: severity,
        body: filtered.message ?? message,
        attributes: toOtelAttrs(filtered.attributes),
        timestamp: Date.now(),
        context: activeSpan,
      });
    } catch (e) {
      this.debug('emitLog failed', e);
    }
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  private debug(...args: unknown[]): void {
    if (this._config.debug) {
      console.log('[scout]', ...args);
    }
  }
}
function toOtelAttrs(a: Attributes): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(a)) {
    out[k] = v;
  }
  return out;
}
function normalizeError(err: unknown): {
  message: string;
  stack: string;
} {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack ?? '' };
  }
  return { message: String(err), stack: '' };
}
function runtimeTypeOf(err: unknown): string {
  if (err === null) return 'Null';
  if (err === undefined) return 'Undefined';
  if (err instanceof Error) {
    return (
      (err as { constructor?: { name?: string }; name?: string }).constructor?.name ??
      err.name ??
      'Error'
    );
  }
  if (typeof err === 'object') {
    return (err as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
  }
  const t = typeof err;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export interface LogOpts {
  error?: unknown;
  stackTrace?: string;
  attributes?: Attributes;
}
function mergeLogAttrs(opts?: LogOpts | Attributes): Attributes | undefined {
  if (!opts) return undefined;
  const candidate = opts as LogOpts;
  if (
    candidate &&
    typeof candidate === 'object' &&
    ('error' in candidate || 'stackTrace' in candidate || 'attributes' in candidate)
  ) {
    const out: Attributes = { ...(candidate.attributes ?? {}) };
    if (candidate.error !== undefined) {
      const { message, stack } = normalizeError(candidate.error);
      out[ATTR.ERROR_MESSAGE] = message;
      if (stack) out[ATTR.ERROR_STACK_TRACE] = stack;
    }
    if (candidate.stackTrace) {
      out[ATTR.ERROR_STACK_TRACE] = candidate.stackTrace;
    }
    return out;
  }
  return opts as Attributes;
}
