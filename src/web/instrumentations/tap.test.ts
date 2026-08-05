// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { InteractionEvent } from '../../core/config';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';
import { installTapTracker } from './tap';
describe('installTapTracker', () => {
  let recorder: Recorder;
  let scout: Scout;
  let dispose: () => void;
  beforeEach(async () => {
    document.body.innerHTML = '';
    recorder = makeRecorder();
    scout = new Scout(
      {
        serviceName: 't',
        endpoint: 'http://localhost',
        secure: false,
        sessionSampleRate: 100,
      },
      memoryPlatform(),
    );
    await scout.bootstrap();
    dispose = installTapTracker(scout);
  });
  afterEach(() => {
    dispose();
  });
  function click(el: Element) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
  it('emits a user_interaction span on click', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Submit';
    document.body.appendChild(btn);
    click(btn);
    const span = recorder.spans()[0];
    expect(span?.name).toBe(SPAN.USER_INTERACTION);
    expect(span?.attributes[ATTR.USER_INTERACTION_TYPE]).toBe('click');
    expect(span?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('Submit');
    expect(span?.attributes[ATTR.USER_INTERACTION_TARGET_TYPE]).toBe('button');
  });
  it('prefers aria-label over text content', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'add-to-cart');
    btn.textContent = 'Add';
    document.body.appendChild(btn);
    click(btn);
    expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe(
      'add-to-cart',
    );
  });
  it('prefers data-scout-action over aria-label', () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-scout-action', 'checkout-cta');
    btn.setAttribute('aria-label', 'pay');
    btn.textContent = 'Pay';
    document.body.appendChild(btn);
    click(btn);
    expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe(
      'checkout-cta',
    );
  });
  it('walks up the DOM to find an ancestor data-scout-action', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-scout-action', 'wrapper-action');
    const inner = document.createElement('span');
    inner.textContent = 'click me';
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    click(inner);
    expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe(
      'wrapper-action',
    );
  });
  it('appends a breadcrumb of type "tap"', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'foo');
    document.body.appendChild(btn);
    click(btn);
    const crumbs = scout.breadcrumbsManager.list();
    expect(crumbs[0]?.type).toBe(BREADCRUMB_TYPE.TAP);
    expect(crumbs[0]?.message).toContain('foo');
  });
  it('emits type=change with the selected option label for a <select>', () => {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', 'environment');
    for (const v of ['prod', 'staging']) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.text = v;
      sel.appendChild(opt);
    }
    document.body.appendChild(sel);
    sel.value = 'staging';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const span = recorder.spans()[0];
    expect(span?.attributes[ATTR.USER_INTERACTION_TYPE]).toBe('change');
    expect(span?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('environment');
    expect(span?.attributes[ATTR.USER_INTERACTION_VALUE]).toBe('staging');
  });
  it('emits type=change with checked state for a checkbox', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'only-errors';
    document.body.appendChild(box);
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    const span = recorder.spans()[0];
    expect(span?.attributes[ATTR.USER_INTERACTION_TYPE]).toBe('change');
    expect(span?.attributes[ATTR.USER_INTERACTION_VALUE]).toBe('checked');
  });
  it('ignores change on a free-text input (fires on blur, reports nothing useful)', () => {
    const text = document.createElement('input');
    text.type = 'text';
    document.body.appendChild(text);
    text.dispatchEvent(new Event('change', { bubbles: true }));
    expect(recorder.spans()).toHaveLength(0);
  });
  it('emits type=submit on form submission', () => {
    const form = document.createElement('form');
    form.setAttribute('aria-label', 'log-search');
    document.body.appendChild(form);
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    const span = recorder.spans()[0];
    expect(span?.attributes[ATTR.USER_INTERACTION_TYPE]).toBe('submit');
    expect(span?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('log-search');
    expect(span?.attributes[ATTR.USER_INTERACTION_TRIGGER]).toBe('unknown');
  });
  it('treats Enter in a search box as a keyboard-triggered submit', () => {
    const input = document.createElement('input');
    input.type = 'search';
    input.setAttribute('aria-label', 'query');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const span = recorder.spans()[0];
    expect(span?.attributes[ATTR.USER_INTERACTION_TYPE]).toBe('submit');
    expect(span?.attributes[ATTR.USER_INTERACTION_TRIGGER]).toBe('keyboard');
  });
  it('ignores non-Enter keys and Enter outside a text entry', () => {
    const input = document.createElement('input');
    input.type = 'search';
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(recorder.spans()).toHaveLength(0);
  });
  it('never derives a description from a password field’s text content', () => {
    const pw = document.createElement('input');
    pw.type = 'password';
    document.body.appendChild(pw);
    pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const span = recorder.spans()[0];
    expect(span?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('redacted');
    expect(span?.attributes[ATTR.USER_INTERACTION_VALUE]).toBeUndefined();
  });
  it('falls back to id then className then tag name', () => {
    const a = document.createElement('button');
    a.id = 'pay-now';
    document.body.appendChild(a);
    click(a);
    expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe(
      '#pay-now',
    );
    recorder.reset();
    const b = document.createElement('button');
    b.className = 'btn-primary other';
    document.body.appendChild(b);
    click(b);
    expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe(
      '.btn-primary',
    );
  });
});

describe('installTapTracker — debounced text edits', () => {
  let recorder: Recorder;
  let scout: Scout;
  let dispose: () => void;
  beforeEach(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    recorder = makeRecorder();
    scout = new Scout(
      {
        serviceName: 't',
        endpoint: 'http://localhost',
        secure: false,
        sessionSampleRate: 100,
      },
      memoryPlatform(),
    );
    await scout.bootstrap();
    dispose = installTapTracker(scout);
  });
  afterEach(() => {
    dispose();
    vi.useRealTimers();
  });
  function textInput(label: string, type = 'text'): HTMLInputElement {
    const el = document.createElement('input');
    el.type = type;
    el.setAttribute('aria-label', label);
    document.body.appendChild(el);
    return el;
  }
  function type(el: HTMLElement) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  it('collapses a burst of keystrokes into one span once typing settles', () => {
    const el = textInput('query');
    type(el);
    type(el);
    type(el);
    expect(recorder.spans()).toHaveLength(0);
    vi.advanceTimersByTime(499);
    expect(recorder.spans()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    const spans = recorder.spans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes[ATTR.USER_INTERACTION_TYPE]).toBe('input');
    expect(spans[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('query');
  });
  it('keeps deferring while the user is still typing', () => {
    const el = textInput('query');
    type(el);
    vi.advanceTimersByTime(400);
    type(el);
    vi.advanceTimersByTime(400);
    expect(recorder.spans()).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(recorder.spans()).toHaveLength(1);
  });
  it('flushes the previous field in edit order when focus moves on', () => {
    const first = textInput('service');
    const second = textInput('query');
    type(first);
    vi.advanceTimersByTime(100);
    type(second);
    // The first edit lands immediately, not when its own timer would have run.
    const afterSwitch = recorder.spans();
    expect(afterSwitch).toHaveLength(1);
    expect(afterSwitch[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('service');
    vi.advanceTimersByTime(500);
    const all = recorder.spans();
    expect(all).toHaveLength(2);
    expect(all[1]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('query');
  });
  it('never reports typing in a sensitive field', () => {
    const pw = textInput('password', 'password');
    type(pw);
    vi.advanceTimersByTime(1000);
    expect(recorder.spans()).toHaveLength(0);
  });
  it('drops a pending edit on dispose rather than firing after teardown', () => {
    const el = textInput('query');
    type(el);
    dispose();
    vi.advanceTimersByTime(1000);
    expect(recorder.spans()).toHaveLength(0);
  });
});

describe('installTapTracker — interactionEvents narrowing', () => {
  let recorder: Recorder;
  let dispose: () => void;
  afterEach(() => dispose());
  async function install(interactionEvents: InteractionEvent[]) {
    document.body.innerHTML = '';
    recorder = makeRecorder();
    const scout = new Scout(
      {
        serviceName: 't',
        endpoint: 'http://localhost',
        secure: false,
        sessionSampleRate: 100,
        interactionEvents,
      },
      memoryPlatform(),
    );
    await scout.bootstrap();
    dispose = installTapTracker(scout);
  }
  it('listens to nothing outside the configured set', async () => {
    await install(['click']);
    const form = document.createElement('form');
    document.body.appendChild(form);
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    expect(recorder.spans()).toHaveLength(0);
    form.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(recorder.spans()).toHaveLength(1);
  });
  it('an empty set disables interaction tracking entirely', async () => {
    await install([]);
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(recorder.spans()).toHaveLength(0);
  });
});
