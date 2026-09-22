// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFrustrationTracker } from './frustration';
import { installTapTracker } from './tap';
import { resetInteractionRegistry } from './interaction-registry';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';

const RAGE_WINDOW_MS = 120;
const DEAD_CLICK_WINDOW_MS = 600;

async function makeScout() {
  const s = new Scout(
    {
      serviceName: 'test-svc',
      endpoint: 'http://localhost:4318',
      secure: false,
      sessionSampleRate: 100,
    },
    memoryPlatform(),
  );
  await s.bootstrap();
  return s;
}

function clickOn(el: Element) {
  el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX: 1042, clientY: 66 }),
  );
}

describe('frustration tracker', () => {
  let recorder: Recorder;
  let scout: Scout;
  let button: HTMLElement;
  const disposers: Array<() => void> = [];

  beforeEach(async () => {
    recorder = makeRecorder();
    resetInteractionRegistry();
    vi.useFakeTimers();
    document.body.innerHTML = '<div data-testid="topbar">topbar</div>';
    button = document.querySelector('[data-testid="topbar"]')!;
    scout = await makeScout();
  });
  afterEach(() => {
    disposers.splice(0).forEach((d) => d());
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  /** Installs in the same order as the web entry point: tap, then frustration. */
  function install({ withTap = true } = {}) {
    if (withTap) disposers.push(installTapTracker(scout));
    disposers.push(installFrustrationTracker(scout));
  }

  const named = (name: string) => recorder.spans().filter((s) => s.name === name);

  const frustrationTypes = () =>
    named(SPAN.USER_FRUSTRATION).map(
      (s) => s.attributes[ATTR.USER_INTERACTION_FRUSTRATION_TYPE],
    );
  function raise(stack: string) {
    const err = new Error('boom');
    err.stack = stack;
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'boom' }));
  }
  const APP_STACK = `Error: boom
    at onClick (https://expert-webapp.snabbit.com/assets/index-Ab12Cd34.js:4:1200)`;
  const SDK_STACK = `TypeError: this.o.at is not a function
    at e._processEntry (https://expert-webapp.snabbit.com/assets/scout-LfkEtGwo.js:1:24567)`;

  it('marks a click followed by an application error as an error_click', async () => {
    install();
    clickOn(button);
    raise(APP_STACK);
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS + 10);
    expect(frustrationTypes()).toContain('error_click');
  });

  it('does not blame a click for an error thrown inside the SDK bundle', async () => {
    // web-vitals' `.at()` TypeError fired on every layout shift on old
    // WebViews, so every click landed next to one (B14-2082).
    install();
    clickOn(button);
    raise(SDK_STACK);
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS + 10);
    expect(frustrationTypes()).not.toContain('error_click');
  });

  it('reports a dead click without emitting a second user_interaction', async () => {
    install();
    clickOn(button);
    // Nothing mutates the DOM, so the click is dead.
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS + 10);

    expect(named(SPAN.USER_INTERACTION)).toHaveLength(1);
    const frustrations = named(SPAN.USER_FRUSTRATION);
    expect(frustrations).toHaveLength(1);
    expect(frustrations[0]!.attributes[ATTR.USER_INTERACTION_FRUSTRATION_TYPE]).toBe(
      'dead_click',
    );
  });

  it('carries the originating interaction id, so the two can be joined', async () => {
    install();
    clickOn(button);
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS + 10);

    const interaction = named(SPAN.USER_INTERACTION)[0]!;
    const frustration = named(SPAN.USER_FRUSTRATION)[0]!;
    const id = interaction.attributes[ATTR.USER_INTERACTION_ID];
    expect(id).toBeTruthy();
    expect(frustration.attributes[ATTR.USER_INTERACTION_ID]).toBe(id);
    expect(frustration.attributes[ATTR.USER_INTERACTION_TARGET]).toBe(
      interaction.attributes[ATTR.USER_INTERACTION_TARGET],
    );
    expect(frustration.attributes[ATTR.USER_INTERACTION_TARGET_TYPE]).toBe(
      interaction.attributes[ATTR.USER_INTERACTION_TARGET_TYPE],
    );
  });

  it('reports a rage click under the frustration name', async () => {
    install();
    clickOn(button);
    clickOn(button);
    clickOn(button);
    vi.advanceTimersByTime(RAGE_WINDOW_MS + 10);

    const frustrations = named(SPAN.USER_FRUSTRATION);
    expect(frustrations.length).toBeGreaterThan(0);
    expect(
      String(frustrations.at(-1)!.attributes[ATTR.USER_INTERACTION_FRUSTRATION_TYPE]),
    ).toContain('rage_click');
    // Three real clicks produced three interaction spans, and no more.
    expect(named(SPAN.USER_INTERACTION)).toHaveLength(3);
  });

  it('does not also call a rage click dead', async () => {
    install();
    clickOn(button);
    clickOn(button);
    clickOn(button);
    // Past both the 120ms rage timer and the 600ms dead-click timer.
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS + 10);

    const types = named(SPAN.USER_FRUSTRATION).map((s) =>
      String(s.attributes[ATTR.USER_INTERACTION_FRUSTRATION_TYPE]),
    );
    expect(types.some((t) => t.includes('dead_click'))).toBe(false);
  });

  it('reports one rage episode once, not once per click in the run', async () => {
    install();
    clickOn(button);
    clickOn(button);
    clickOn(button);
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS + 10);

    expect(named(SPAN.USER_FRUSTRATION)).toHaveLength(1);
  });

  it('stays quiet when the click mutates the DOM', async () => {
    install();
    button.addEventListener('click', () => {
      document.body.appendChild(document.createElement('span'));
    });
    clickOn(button);
    // MutationObserver callbacks are microtasks, not timers.
    await Promise.resolve();
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS + 10);

    expect(named(SPAN.USER_FRUSTRATION)).toHaveLength(0);
  });

  it('still reports when the tap tracker is disabled, just without correlation', async () => {
    install({ withTap: false });
    clickOn(button);
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS + 10);

    const frustrations = named(SPAN.USER_FRUSTRATION);
    expect(frustrations).toHaveLength(1);
    expect(frustrations[0]!.attributes[ATTR.USER_INTERACTION_ID]).toBeUndefined();
  });

  it('emits nothing after dispose', async () => {
    install();
    disposers.splice(0).forEach((d) => d());
    clickOn(button);
    vi.advanceTimersByTime(DEAD_CLICK_WINDOW_MS + 10);

    expect(named(SPAN.USER_FRUSTRATION)).toHaveLength(0);
  });
});
