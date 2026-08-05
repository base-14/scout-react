import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import { DEFAULT_INTERACTION_EVENTS, type InteractionEvent } from '../../core/config';
import type { Scout } from '../../core/scout';
import type { Attributes } from '../../core/types';
import { uuidv4 } from '../../core/uuid';
/**
 * Fields whose *existence* we still report, but which must never contribute a
 * description or a value — a placeholder or aria-label on a password box is
 * frequently the only thing distinguishing it, and text inputs hold whatever
 * the user typed.
 */
const SENSITIVE_INPUT_TYPES = new Set(['password', 'email', 'tel', 'hidden']);
export function installTapTracker(scout: Scout): () => void {
  if (typeof document === 'undefined') return () => {};
  const enabled = new Set<InteractionEvent>(
    scout.config.interactionEvents ?? DEFAULT_INTERACTION_EVENTS,
  );
  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof DocumentEventMap>(
    type: K,
    handler: (e: DocumentEventMap[K]) => void,
  ) => {
    document.addEventListener(type, handler as EventListener, {
      capture: true,
      passive: true,
    });
    cleanups.push(() =>
      document.removeEventListener(type, handler as EventListener, { capture: true }),
    );
  };
  const emit = (
    kind: InteractionEvent,
    target: HTMLElement,
    e: Event,
    extra: Attributes = {},
  ) => {
    try {
      const { description, source } = describeElement(target);
      const typeName = target.tagName ? target.tagName.toLowerCase() : 'unknown';
      const rect = target.getBoundingClientRect?.();
      scout.emitSpan(SPAN.USER_INTERACTION, {
        [ATTR.USER_INTERACTION_ID]: uuidv4(),
        [ATTR.USER_INTERACTION_TYPE]: kind,
        [ATTR.USER_INTERACTION_TARGET]: description,
        [ATTR.USER_INTERACTION_TARGET_TYPE]: typeName,
        [ATTR.USER_INTERACTION_TARGET_NAME_SOURCE]: source,
        [ATTR.USER_INTERACTION_TARGET_SELECTOR]: cssSelectorOf(target),
        [ATTR.USER_INTERACTION_TARGET_COMPOSED_PATH_SELECTOR]: composedPathSelector(e),
        ...(rect
          ? {
              [ATTR.USER_INTERACTION_TARGET_WIDTH]: Math.round(rect.width),
              [ATTR.USER_INTERACTION_TARGET_HEIGHT]: Math.round(rect.height),
            }
          : {}),
        ...extra,
        ...scout.commonAttributes(),
      });
      scout.addBreadcrumb(BREADCRUMB_TYPE.TAP, `${kind} ${typeName}: ${description}`);
    } catch {}
  };
  if (enabled.has('click')) {
    listen('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      emit('click', target, e, {
        [ATTR.USER_INTERACTION_TRIGGER]: 'pointer',
        [ATTR.USER_INTERACTION_TARGET_X]: Math.round(e.clientX),
        [ATTR.USER_INTERACTION_TARGET_Y]: Math.round(e.clientY),
      });
    });
  }
  if (enabled.has('change')) {
    // `change` is the only signal for <select> and for checkbox/radio reached by
    // keyboard; a click listener alone reports the widget was touched but never
    // that a value was actually committed.
    listen('change', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target || !isValueControl(target)) return;
      emit('change', target, e, {
        [ATTR.USER_INTERACTION_TRIGGER]: 'unknown',
        ...selectionAttributes(target),
      });
    });
  }
  if (enabled.has('submit')) {
    listen('submit', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      emit('submit', target, e, { [ATTR.USER_INTERACTION_TRIGGER]: 'unknown' });
    });
    // Enter inside a search box is a submit the user perceives but the DOM often
    // never fires a `submit` for — React handlers routinely swallow it.
    listen('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (!target || !isTextEntry(target)) return;
      emit('submit', target, e, { [ATTR.USER_INTERACTION_TRIGGER]: 'keyboard' });
    });
  }
  if (enabled.has('input')) {
    // A settled edit — the user stopped typing — rather than one span per
    // keystroke. `pending` holds the timer for the field currently being edited.
    let pending: ReturnType<typeof setTimeout> | undefined;
    let pendingTarget: HTMLElement | null = null;
    const flush = () => {
      if (!pendingTarget) return;
      const target = pendingTarget;
      pendingTarget = null;
      emit('input', target, new Event('input'), {
        [ATTR.USER_INTERACTION_TRIGGER]: 'keyboard',
      });
    };
    listen('input', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target || !isTextEntry(target)) return;
      handleTextEdit(target, {
        pendingTarget,
        setPendingTarget: (el) => {
          pendingTarget = el;
        },
        restartTimer: (ms) => {
          if (pending) clearTimeout(pending);
          pending = setTimeout(flush, ms);
        },
        flushNow: () => {
          if (pending) clearTimeout(pending);
          flush();
        },
      });
    });
    cleanups.push(() => {
      if (pending) clearTimeout(pending);
      pendingTarget = null;
    });
  }
  return () => {
    for (const c of cleanups) c();
  };
}
/** Quiet period that marks the end of one edit. */
const TEXT_EDIT_SETTLE_MS = 500;
/**
 * Decides when a stream of `input` events becomes one reportable edit.
 *
 * Sensitive fields are dropped outright: the span could only ever say "someone
 * typed in a password box", which is not worth the row it costs.
 *
 * Moving to a different field flushes the previous edit immediately rather than
 * letting its timer expire. Two pending timers would emit in timer order, not
 * edit order, so a form filled top-to-bottom could report bottom-to-top.
 */
function handleTextEdit(
  target: HTMLElement,
  ctl: {
    pendingTarget: HTMLElement | null;
    setPendingTarget: (el: HTMLElement | null) => void;
    restartTimer: (ms: number) => void;
    flushNow: () => void;
  },
): void {
  if (isSensitive(target)) return;
  if (ctl.pendingTarget && ctl.pendingTarget !== target) ctl.flushNow();
  ctl.setPendingTarget(target);
  ctl.restartTimer(TEXT_EDIT_SETTLE_MS);
}
/**
 * True for controls whose `change` event means "a value was committed".
 * Free-text inputs are excluded — they fire `change` on blur, which reports an
 * edit at a time and place the user does not associate with anything.
 */
function isValueControl(el: HTMLElement): boolean {
  const tag = el.tagName?.toLowerCase();
  if (tag === 'select') return true;
  if (tag !== 'input') return false;
  const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
  return [
    'checkbox',
    'radio',
    'file',
    'date',
    'datetime-local',
    'time',
    'range',
  ].includes(type);
}
function isTextEntry(el: HTMLElement): boolean {
  const tag = el.tagName?.toLowerCase();
  if (tag === 'textarea') return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute?.('role') === 'searchbox') return true;
  if (tag !== 'input') return false;
  const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
  return ['text', 'search', 'url', 'number', 'email', 'tel', 'password'].includes(type);
}
/**
 * Describes *what* was chosen without leaking free text. Only controls whose
 * value space is closed (checkbox state, select option label) contribute a
 * value; everything else reports the fact of a change and nothing more.
 */
function selectionAttributes(el: HTMLElement): Attributes {
  const tag = el.tagName?.toLowerCase();
  try {
    if (tag === 'select') {
      const sel = el as HTMLSelectElement;
      const label = sel.selectedOptions?.[0]?.text ?? '';
      return label ? { [ATTR.USER_INTERACTION_VALUE]: label.trim().slice(0, 60) } : {};
    }
    const input = el as HTMLInputElement;
    const type = input.type?.toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      return { [ATTR.USER_INTERACTION_VALUE]: input.checked ? 'checked' : 'unchecked' };
    }
  } catch {}
  return {};
}
function describeElement(el: HTMLElement): {
  description: string;
  source: string;
} {
  const scoutAction =
    el.getAttribute?.('data-scout-action') ??
    el.closest?.('[data-scout-action]')?.getAttribute('data-scout-action');
  if (scoutAction) return { description: scoutAction, source: 'custom_attribute' };
  const aria = el.getAttribute?.('aria-label');
  if (aria) return { description: aria, source: 'standard_attribute' };
  const id = el.id;
  if (id) return { description: `#${id}`, source: 'standard_attribute' };
  const dataTest = el.getAttribute?.('data-testid') ?? el.getAttribute?.('data-test');
  if (dataTest)
    return { description: `[data-testid=${dataTest}]`, source: 'standard_attribute' };
  if (isSensitive(el)) return { description: 'redacted', source: 'redacted' };
  const text = (el.textContent ?? '').trim().slice(0, 60);
  if (text) return { description: text, source: 'text_content' };
  const cls =
    el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : '';
  if (cls) return { description: `.${cls}`, source: 'standard_attribute' };
  return { description: el.tagName?.toLowerCase() ?? 'unknown', source: 'blank' };
}
function isSensitive(el: HTMLElement): boolean {
  if (el.tagName?.toLowerCase() !== 'input') return false;
  const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
  return SENSITIVE_INPUT_TYPES.has(type);
}
function cssSelectorOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 10) {
    const id = cur.id ? `#${cur.id}` : '';
    const cls =
      typeof cur.className === 'string' && cur.className
        ? `.${cur.className.split(/\s+/).filter(Boolean).join('.')}`
        : '';
    parts.unshift(`${cur.tagName.toLowerCase()}${id}${cls}`);
    if (cur.id) break;
    cur = cur.parentElement;
    depth++;
  }
  return parts.join('>');
}
function composedPathSelector(e: Event): string {
  try {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path
      .filter((n): n is Element => n instanceof Element)
      .slice(0, 10)
      .map((node) => {
        const id = node.id ? `#${node.id}` : '';
        return `${node.tagName.toLowerCase()}${id}`;
      })
      .join('>');
  } catch {
    return '';
  }
}
