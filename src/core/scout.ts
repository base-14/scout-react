import {
  context,
  trace,
  metrics,
  type Tracer,
  type Meter,
  type Span,
  SpanStatusCode,
} from '@opentelemetry/api';
import { logs, type Logger as OtelLogger } from '@opentelemetry/api-logs';
import { ATTR } from './attributes';
import { SPAN, BREADCRUMB_TYPE, ERROR_CLASS_SPANS } from './spans';
import { METRIC } from './metrics';
import { applyBeforeSend } from './before-send';
import { BreadcrumbManager } from './breadcrumb-manager';
import { SessionManager } from './session-manager';
import { UserManager } from './user-manager';
import { SEVERITY_NUMBER } from './logger';
import { resolveConfig, type ResolvedConfig, type ScoutConfig } from './config';
import type { PlatformAdapter } from './platform';
import type { Attributes, AttributeValue, SeverityText } from './types';
import { SCOPE_NAME, SCOPE_VERSION } from './scope';
import { uuidv4 } from './uuid';
const MAX_STACK_LEN = 8000;
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
  private _config: ResolvedConfig;
  private platform: PlatformAdapter;
  private tracer: Tracer;
  private meter: Meter;
  private otelLogger: OtelLogger;
  private session: SessionManager;
  private breadcrumbs: BreadcrumbManager;
  private user = new UserManager();
  private errorCounter: ReturnType<Meter['createCounter']> | null = null;
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
  }
  async bootstrap(): Promise<void> {
    await this.session.start();
    await this.breadcrumbs.hydrate();
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
  get sessionId(): string | null {
    return this.session.sessionId;
  }
  get userId(): string | null {
    return this.user.id;
  }
  get userAttributes(): Readonly<Attributes> {
    return this.user.attributes;
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
  commonAttributes(): Attributes {
    const attrs: Attributes = {
      [ATTR.NETWORK_CONNECTION_TYPE]: this._connectionType,
      [ATTR.SESSION_TYPE]: 'user',
      ...this._runtimeAttrs,
    };
    const sid = this.session.sessionId;
    if (sid) attrs[ATTR.SESSION_ID] = sid;
    const uid = this.user.id;
    if (uid) attrs[ATTR.USER_ID] = uid;
    for (const [k, v] of Object.entries(this.user.attributes)) {
      attrs[k.startsWith('user.') ? k : `user.${k}`] = v;
    }
    const anon = this._anonymousId;
    if (anon) attrs[ATTR.USER_ANONYMOUS_ID] = anon;
    return attrs;
  }
  private _anonymousId: string | null = null;
  private _webViewBridgeSend?: (payload: Record<string, unknown>) => void;
  setWebViewBridge(bridge: {
    sessionId?: string;
    anonymousId?: string;
    send?: (payload: Record<string, unknown>) => void;
  }): void {
    if (typeof bridge?.sessionId === 'string' && bridge.sessionId) {
      this.session.adoptExternalSessionId(bridge.sessionId);
    }
    if (typeof bridge?.anonymousId === 'string' && bridge.anonymousId) {
      this._anonymousId = bridge.anonymousId;
    }
    if (typeof bridge?.send === 'function') {
      this._webViewBridgeSend = bridge.send;
    }
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
    this.breadcrumbs.add(type, message);
  }
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
      [ATTR.VITAL_DURATION_NS]: durationMs * 1000000,
      ...this.commonAttributes(),
    };
    if (v.description) attrs[ATTR.VITAL_DESCRIPTION] = v.description;
    this.emitSpan(SPAN.CUSTOM_VITAL, attrs);
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
      [ATTR.ERROR_TIME_SINCE_APP_START_MS]: this.timeSinceAppStartMs(),
      [ATTR.BREADCRUMBS]: this.breadcrumbs.serialize(),
      ...this.commonAttributes(),
    };
    if (opts?.library) attrs[ATTR.ERROR_LIBRARY] = opts.library;
    if (opts?.componentStack) attrs[ATTR.ERROR_COMPONENT_STACK] = opts.componentStack;
    if (opts?.fingerprint) attrs[ATTR.ERROR_FINGERPRINT] = opts.fingerprint;
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
    this.breadcrumbs.add(BREADCRUMB_TYPE.ERROR, message);
  }
  reportUncaught(error: unknown): void {
    const { message, stack } = normalizeError(error);
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
      [ATTR.ERROR_TIME_SINCE_APP_START_MS]: this.timeSinceAppStartMs(),
      [ATTR.BREADCRUMBS]: this.breadcrumbs.serialize(),
      ...this.commonAttributes(),
    };
    const causes = extractErrorCauses(error);
    if (causes.length > 0) {
      attrs[ATTR.ERROR_CAUSES_JSON] = JSON.stringify(causes).slice(0, 4000);
    }
    this.emitSpan(SPAN.ERROR, attrs, { status: SpanStatusCode.ERROR });
    this.errorCounter?.add(1, { handled: 'false' });
    this.breadcrumbs.add(BREADCRUMB_TYPE.ERROR, message);
  }
  setUser(id: string, attributes?: Attributes): void {
    this.user.set(id, attributes);
  }
  clearUser(): void {
    this.user.clear();
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
    const bypassForErrors =
      this._config.alwaysCaptureErrors && ERROR_CLASS_SPANS.has(name);
    if (!opts.forceSample && !bypassForErrors && !this.session.isSampled) {
      return null;
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
  private bumpViewCounter(spanName: string, attributes: Attributes): void {
    const screen = attributes[ATTR.SCREEN_NAME] ?? this._runtimeAttrs[ATTR.SCREEN_NAME];
    const dims: Record<string, string> = {};
    if (typeof screen === 'string' && screen) dims[ATTR.SCREEN_NAME] = screen;
    try {
      switch (spanName) {
        case SPAN.USER_INTERACTION:
          this.viewCounters.action?.add(1, dims);
          if (attributes['action.frustration.type'] != null) {
            this.viewCounters.frustration?.add(1, dims);
          }
          break;
        case SPAN.ERROR:
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
    if (!this.session.isSampled) return null;
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
    if (!this.session.isSampled) return;
    const filtered = applyBeforeSend(this._config.beforeSend, 'metric', name, {
      ...attrs,
      ...this.commonAttributes(),
      value,
    });
    if (!filtered) return;
    try {
      const histogram = this.meter.createHistogram(name);
      const recordAttrs = { ...filtered.attributes };
      delete recordAttrs.value;
      histogram.record(value, toOtelAttrs(recordAttrs));
    } catch (e) {
      this.debug('emitHistogram failed', e);
    }
  }
  emitGauge(name: string, value: number, attrs: Attributes = {}): void {
    if (!this.session.isSampled) return;
    const filtered = applyBeforeSend(this._config.beforeSend, 'metric', name, {
      ...attrs,
      ...this.commonAttributes(),
      value,
    });
    if (!filtered) return;
    try {
      const gauge = this.meter.createUpDownCounter(name);
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
    if (!this._config.enableLogging) return;
    const bypassForErrors = this._config.alwaysCaptureErrors && severity === 'ERROR';
    if (!opts.forceSample && !bypassForErrors && !this.session.isSampled) {
      return;
    }
    const base: Attributes = {
      ...this.commonAttributes(),
      ...(attributes ?? {}),
    };
    const filtered = applyBeforeSend(this._config.beforeSend, 'log', 'log', base, {
      severity,
      message,
    });
    if (!filtered) return;
    try {
      this.otelLogger.emit({
        severityNumber: SEVERITY_NUMBER[severity],
        severityText: severity,
        body: filtered.message ?? message,
        attributes: toOtelAttrs(filtered.attributes),
        timestamp: Date.now(),
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
      console.warn('[scout]', ...args);
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
