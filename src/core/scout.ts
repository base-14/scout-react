import { context, trace, metrics, type Tracer, type Meter, type Span, SpanStatusCode, } from '@opentelemetry/api';
import { logs, type Logger as OtelLogger } from '@opentelemetry/api-logs';
import { ATTR } from './attributes';
import { SPAN, BREADCRUMB_TYPE } from './spans';
import { METRIC } from './metrics';
import { applyBeforeSend } from './before-send';
import { BreadcrumbManager } from './breadcrumb-manager';
import { SessionManager } from './session-manager';
import { UserManager } from './user-manager';
import { SEVERITY_NUMBER } from './logger';
import { resolveConfig, type ResolvedConfig, type ScoutConfig } from './config';
import type { PlatformAdapter } from './platform';
import type { Attributes, AttributeValue, SeverityText } from './types';
const TRACER_NAME = '@base14/scout-react';
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
    private _connectionType = 'unknown';
    private _rootSpan: Span | null = null;
    private _runtimeAttrs: Attributes = {};
    constructor(config: ScoutConfig, platform: PlatformAdapter) {
        this._config = resolveConfig(config);
        this.platform = platform;
        this.tracer = trace.getTracer(TRACER_NAME, '0.1.0');
        this.meter = metrics.getMeter(TRACER_NAME, '0.1.0');
        this.otelLogger = logs.getLogger(TRACER_NAME, '0.1.0');
        this.session = new SessionManager(platform, {
            timeoutMinutes: this._config.sessionTimeoutMinutes,
            sampleRate: this._config.sessionSampleRate,
        });
        this.breadcrumbs = new BreadcrumbManager(platform);
    }
    async bootstrap(): Promise<void> {
        await this.session.start();
        await this.breadcrumbs.hydrate();
        if (this._config.enablePerformanceMetrics || this._config.enableErrorTracking) {
            try {
                this.errorCounter = this.meter.createCounter(METRIC.ERROR_COUNT, {
                    description: 'Count of errors observed by Scout',
                });
            }
            catch {
            }
        }
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
    setRootSpan(span: Span | null, opts: {
        endPrevious?: boolean;
    } = {}): void {
        const { endPrevious = true } = opts;
        if (endPrevious && this._rootSpan && this._rootSpan !== span) {
            try {
                this._rootSpan.end();
            }
            catch {
            }
        }
        this._rootSpan = span;
    }
    startRootSpan(name: string, attributes: Attributes = {}): Span {
        const span = this.tracer.startSpan(name, {
            attributes: toOtelAttrs({ ...attributes, ...this.commonAttributes() }),
        });
        this.setRootSpan(span);
        return span;
    }
    commonAttributes(): Attributes {
        const attrs: Attributes = {
            [ATTR.NETWORK_CONNECTION_TYPE]: this._connectionType,
            ...this._runtimeAttrs,
        };
        const sid = this.session.sessionId;
        if (sid)
            attrs[ATTR.SESSION_ID] = sid;
        const uid = this.user.id;
        if (uid)
            attrs[ATTR.ENDUSER_ID] = uid;
        for (const [k, v] of Object.entries(this.user.attributes)) {
            attrs[`enduser.${k}`] = v;
        }
        return attrs;
    }
    setRuntimeAttribute(key: string, value: AttributeValue | null | undefined): void {
        if (value == null) {
            delete this._runtimeAttrs[key];
        }
        else {
            this._runtimeAttrs[key] = value;
        }
    }
    logEvent(name: string, attributes?: Attributes): void {
        this.emitSpan(name, { ...(attributes ?? {}), ...this.commonAttributes() });
    }
    addBreadcrumb(type: string, message: string): void {
        this.breadcrumbs.add(type, message);
    }
    reportError(error: unknown, opts?: {
        handled?: boolean;
        library?: string;
        componentStack?: string;
    }): void {
        const handled = opts?.handled ?? true;
        const { message, stack } = normalizeError(error);
        const attrs: Attributes = {
            [ATTR.ERROR_TYPE]: 'manual_error',
            [ATTR.ERROR_MESSAGE]: message,
            [ATTR.ERROR_STACK_TRACE]: stack,
            [ATTR.ERROR_HANDLED]: String(handled),
            [ATTR.BREADCRUMBS]: this.breadcrumbs.serialize(),
            ...this.commonAttributes(),
        };
        if (opts?.library)
            attrs[ATTR.ERROR_LIBRARY] = opts.library;
        if (opts?.componentStack)
            attrs[ATTR.ERROR_COMPONENT_STACK] = opts.componentStack;
        this.emitSpan(SPAN.ERROR, attrs, { status: SpanStatusCode.ERROR });
        this.errorCounter?.add(1, { handled: String(handled) });
        this.breadcrumbs.add(BREADCRUMB_TYPE.ERROR, message);
    }
    reportUncaught(error: unknown): void {
        const { message, stack } = normalizeError(error);
        const attrs: Attributes = {
            [ATTR.ERROR_TYPE]: 'uncaught_error',
            [ATTR.ERROR_MESSAGE]: message,
            [ATTR.ERROR_STACK_TRACE]: stack,
            [ATTR.ERROR_HANDLED]: 'false',
            [ATTR.BREADCRUMBS]: this.breadcrumbs.serialize(),
            ...this.commonAttributes(),
        };
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
    emitSpan(name: string, attributes: Attributes, opts: {
        status?: SpanStatusCode;
        startTime?: number;
        endTime?: number;
    } = {}): Span | null {
        if (!this.session.isSampled)
            return null;
        const filtered = applyBeforeSend(this._config.beforeSend, 'span', name, attributes);
        if (!filtered)
            return null;
        let span: Span;
        try {
            const parentCtx = this._rootSpan && this._rootSpan !== this._rootSpanSentinel
                ? trace.setSpan(context.active(), this._rootSpan)
                : context.active();
            span = this.tracer.startSpan(name, {
                startTime: opts.startTime,
                attributes: toOtelAttrs(filtered.attributes),
            }, parentCtx);
        }
        catch (e) {
            this.debug('emitSpan failed', e);
            return null;
        }
        if (opts.status === SpanStatusCode.ERROR) {
            span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end(opts.endTime);
        this.session.touch();
        return span;
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
        if (!this.session.isSampled)
            return null;
        try {
            const parentCtx = this._rootSpan
                ? trace.setSpan(context.active(), this._rootSpan)
                : context.active();
            return this.tracer.startSpan(name, { attributes: toOtelAttrs(attributes) }, parentCtx);
        }
        catch (e) {
            this.debug('startChildSpan failed', e);
            return null;
        }
    }
    emitHistogram(name: string, value: number, attrs: Attributes = {}): void {
        if (!this.session.isSampled)
            return;
        const filtered = applyBeforeSend(this._config.beforeSend, 'metric', name, {
            ...attrs,
            ...this.commonAttributes(),
            value,
        });
        if (!filtered)
            return;
        try {
            const histogram = this.meter.createHistogram(name);
            histogram.record(value, toOtelAttrs(this.commonAttributes()));
        }
        catch (e) {
            this.debug('emitHistogram failed', e);
        }
    }
    emitGauge(name: string, value: number, attrs: Attributes = {}): void {
        if (!this.session.isSampled)
            return;
        const filtered = applyBeforeSend(this._config.beforeSend, 'metric', name, {
            ...attrs,
            ...this.commonAttributes(),
            value,
        });
        if (!filtered)
            return;
        try {
            const gauge = this.meter.createUpDownCounter(name);
            gauge.add(value, toOtelAttrs(this.commonAttributes()));
        }
        catch (e) {
            this.debug('emitGauge failed', e);
        }
    }
    emitLog(severity: SeverityText, message: string, attributes?: Attributes): void {
        if (!this._config.enableLogging)
            return;
        if (!this.session.isSampled)
            return;
        const base: Attributes = {
            ...this.commonAttributes(),
            ...(attributes ?? {}),
        };
        const filtered = applyBeforeSend(this._config.beforeSend, 'log', 'log', base, {
            severity,
            message,
        });
        if (!filtered)
            return;
        try {
            this.otelLogger.emit({
                severityNumber: SEVERITY_NUMBER[severity],
                severityText: severity,
                body: filtered.message ?? message,
                attributes: toOtelAttrs(filtered.attributes),
                timestamp: Date.now(),
            });
        }
        catch (e) {
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
    if (!opts)
        return undefined;
    const candidate = opts as LogOpts;
    if (candidate &&
        typeof candidate === 'object' &&
        ('error' in candidate || 'stackTrace' in candidate || 'attributes' in candidate)) {
        const out: Attributes = { ...(candidate.attributes ?? {}) };
        if (candidate.error !== undefined) {
            const { message, stack } = normalizeError(candidate.error);
            out[ATTR.ERROR_MESSAGE] = message;
            if (stack)
                out[ATTR.ERROR_STACK_TRACE] = stack;
        }
        if (candidate.stackTrace) {
            out[ATTR.ERROR_STACK_TRACE] = candidate.stackTrace;
        }
        return out;
    }
    return opts as Attributes;
}
