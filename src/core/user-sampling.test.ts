import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scout, USER_SAMPLING_KEY } from './scout';
import { ATTR } from './attributes';
import { SessionManager, shouldRotateOnIdentityChange } from './session-manager';
import { makeRecorder, memoryPlatform, type Recorder } from '../test/recorder';

type Platform = ReturnType<typeof memoryPlatform>;

async function makeScout(
  overrides: Record<string, unknown> = {},
  platform: Platform = memoryPlatform(),
) {
  const s = new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
      ...overrides,
    } as never,
    platform,
  );
  await s.bootstrap();
  return s;
}

function attr(rec: { attributes: Record<string, unknown> }, key: string) {
  return rec.attributes[key];
}

describe('user-based sampling: §3 decision table', () => {
  let rec: Recorder;
  beforeEach(() => {
    rec = makeRecorder();
  });

  it('true keeps the session even at a 0% fallback rate', async () => {
    const s = await makeScout({ sessionSampleRate: 0, userSampling: true });
    s.emitSpan('screen_view', s.commonAttributes());
    expect(rec.spans()).toHaveLength(1);
    expect(attr(rec.spans()[0], ATTR.SESSION_SAMPLING_SOURCE)).toBe('user');
  });

  it('false drops non-error spans even at a 100% fallback rate', async () => {
    const s = await makeScout({ sessionSampleRate: 100, userSampling: false });
    s.emitSpan('screen_view', s.commonAttributes());
    expect(rec.spans()).toHaveLength(0);
  });

  it('false still sends logs and metrics, tagged as user-decided and unsampled', async () => {
    const s = await makeScout({ userSampling: false });
    s.logInfo('hello');
    s.emitHistogram('rc.histogram', 1);
    s.emitGauge('rc.gauge', 1);
    expect(rec.logs()).toHaveLength(1);
    expect(attr(rec.logs()[0], ATTR.SESSION_SAMPLING_SOURCE)).toBe('user');
    expect(attr(rec.logs()[0], ATTR.SESSION_SAMPLED)).toBe('false');
    const names = (await rec.metrics())
      .flatMap((r) => r.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .map((m) => m.descriptor.name);
    expect(names).toEqual(expect.arrayContaining(['rc.histogram', 'rc.gauge']));
  });

  it('false still lets error-class spans through while alwaysCaptureErrors is on', async () => {
    const s = await makeScout({ userSampling: false });
    s.emitSpan('error', s.commonAttributes());
    expect(rec.spans()).toHaveLength(1);
    expect(attr(rec.spans()[0], ATTR.SESSION_SAMPLED)).toBe('false');
    expect(attr(rec.spans()[0], ATTR.SESSION_SAMPLING_SOURCE)).toBe('user');
  });

  it('false sends no error spans when alwaysCaptureErrors is off', async () => {
    const s = await makeScout({ userSampling: false, alwaysCaptureErrors: false });
    s.emitSpan('error', s.commonAttributes());
    expect(rec.spans()).toHaveLength(0);
  });

  it('null falls back to the rate and keeps today’s behaviour for sampled-out sessions', async () => {
    const out = await makeScout({ sessionSampleRate: 0 });
    out.emitSpan('screen_view', out.commonAttributes());
    out.logInfo('dropped');
    out.emitGauge('rc.gauge', 1);
    expect(rec.spans()).toHaveLength(0);
    expect(rec.logs()).toHaveLength(0);
    const kept = await makeScout({ sessionSampleRate: 100 });
    kept.emitSpan('screen_view', kept.commonAttributes());
    expect(attr(rec.spans()[0], ATTR.SESSION_SAMPLING_SOURCE)).toBe('fallback');
  });
});

describe('user-based sampling: precedence and persistence', () => {
  beforeEach(() => {
    makeRecorder();
  });

  it('a non-null init value wins over the stored one and is persisted', async () => {
    const platform = memoryPlatform();
    await platform.setItem(USER_SAMPLING_KEY, 'false');
    const s = await makeScout({ userSampling: true }, platform);
    expect(s.userSampling).toBe(true);
    expect(await platform.getItem(USER_SAMPLING_KEY)).toBe('true');
  });

  it('a null init value keeps the stored value, which decides the first session', async () => {
    const platform = memoryPlatform();
    await platform.setItem(USER_SAMPLING_KEY, 'false');
    const s = await makeScout({ userSampling: null }, platform);
    expect(s.userSampling).toBe(false);
    expect(s.commonAttributes()[ATTR.SESSION_SAMPLING_SOURCE]).toBe('user');
  });

  it('setUserSampling(null) clears the stored value', async () => {
    const platform = memoryPlatform();
    const s = await makeScout({ userSampling: true }, platform);
    s.setUserSampling(null);
    await Promise.resolve();
    expect(await platform.getItem(USER_SAMPLING_KEY)).toBeNull();
  });

  it('a runtime value set before bootstrap wins over init and stored values', async () => {
    const platform = memoryPlatform();
    await platform.setItem(USER_SAMPLING_KEY, 'true');
    const s = new Scout(
      {
        serviceName: 'svc',
        endpoint: 'http://x',
        userSampling: true,
        sessionSampleRate: 100,
      } as never,
      platform,
    );
    s.setUserSampling(false);
    await s.bootstrap();
    expect(s.commonAttributes()[ATTR.SESSION_SAMPLING_SOURCE]).toBe('user');
    expect(s.userSampling).toBe(false);
  });
});

describe('user-based sampling: never mid-session', () => {
  beforeEach(() => {
    makeRecorder();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a runtime change does not touch the current session, but applies after rotation', async () => {
    const s = await makeScout();
    const first = s.sessionId;
    s.setUserSampling(false);
    expect(s.sessionId).toBe(first);
    expect(s.commonAttributes()[ATTR.SESSION_SAMPLING_SOURCE]).toBe('fallback');
    vi.setSystemTime(new Date('2026-11-04T11:01:00Z')); // past the 60 min max duration
    expect(s.sessionId).not.toBe(first);
    expect(s.commonAttributes()[ATTR.SESSION_SAMPLING_SOURCE]).toBe('user');
  });

  it('a resumed session keeps its decision even if the init value changed', async () => {
    const platform = memoryPlatform();
    const a = await makeScout({ userSampling: false }, platform);
    const id = a.sessionId;
    vi.setSystemTime(new Date('2026-11-04T10:05:00Z'));
    const b = await makeScout({ userSampling: true }, platform);
    expect(b.sessionId).toBe(id);
    expect(b.commonAttributes()[ATTR.SESSION_SAMPLING_SOURCE]).toBe('user');
    const rec = makeRecorder();
    b.emitSpan('screen_view', b.commonAttributes());
    expect(rec.spans()).toHaveLength(0);
  });

  it('a legacy persisted session without a source reads as fallback', async () => {
    const platform = memoryPlatform();
    const now = Date.now();
    await platform.setItem(
      'scout.session',
      JSON.stringify({ id: 'legacy', startedAt: now, lastActiveAt: now, sampled: true }),
    );
    const sm = new SessionManager(platform, { timeoutMinutes: 30, sampleRate: 100 });
    await sm.start();
    expect(sm.sessionId).toBe('legacy');
    expect(sm.samplingSource).toBe('fallback');
  });
});

describe('user-based sampling: §5 user-switch rotation', () => {
  beforeEach(() => {
    makeRecorder();
  });

  it('predicate matrix', () => {
    expect(shouldRotateOnIdentityChange(null, 'a', 'user', true)).toBe(false);
    expect(shouldRotateOnIdentityChange('a', 'a', 'user', false)).toBe(false);
    expect(shouldRotateOnIdentityChange('a', 'b', 'user', null)).toBe(true);
    expect(shouldRotateOnIdentityChange('a', 'b', 'fallback', false)).toBe(true);
    expect(shouldRotateOnIdentityChange('a', 'b', 'fallback', null)).toBe(false);
    expect(shouldRotateOnIdentityChange('a', null, 'user', null)).toBe(true);
    expect(shouldRotateOnIdentityChange('a', null, 'fallback', null)).toBe(false);
  });

  it('anonymous → first login keeps the session', async () => {
    const s = await makeScout({ userSampling: false });
    const id = s.sessionId;
    s.setUser('alice');
    expect(s.sessionId).toBe(id);
  });

  it('account switch with a pending value starts a new session using that value', async () => {
    const s = await makeScout();
    s.setUser('alice');
    const id = s.sessionId;
    s.setUserSampling(false);
    s.setUser('bob');
    expect(s.sessionId).not.toBe(id);
    expect(s.commonAttributes()[ATTR.SESSION_SAMPLING_SOURCE]).toBe('user');
  });

  it('clearUser resets the value and rotates into a fallback session', async () => {
    const platform = memoryPlatform();
    const s = await makeScout({ userSampling: false }, platform);
    s.setUser('alice');
    const id = s.sessionId;
    s.clearUser();
    expect(s.sessionId).not.toBe(id);
    expect(s.userSampling).toBeNull();
    expect(s.commonAttributes()[ATTR.SESSION_SAMPLING_SOURCE]).toBe('fallback');
    await Promise.resolve();
    expect(await platform.getItem(USER_SAMPLING_KEY)).toBeNull();
  });

  it('apps that never use the feature see no extra sessions', async () => {
    const s = await makeScout();
    const id = s.sessionId;
    s.setUser('alice');
    s.setUser('bob');
    s.clearUser();
    expect(s.sessionId).toBe(id);
  });
});
