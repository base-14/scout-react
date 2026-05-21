import { ATTR } from '../../core/attributes';
import { SPAN } from '../../core/spans';
import type { Scout } from '../../core/scout';
import type { Attributes } from '../../core/types';
export function installFrustrationTracker(scout: Scout): () => void {
  if (typeof document === 'undefined') return () => {};
  type ClickRow = {
    target: Element;
    selector: string;
    t: number;
  };
  const recent: ClickRow[] = [];
  const pending: Array<{
    row: ClickRow;
    attrs: Attributes;
    mutated: boolean;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  let lastErrorAt = 0;
  let mutObserver: MutationObserver | null = null;
  try {
    mutObserver = new MutationObserver(() => {
      for (const p of pending) p.mutated = true;
    });
    mutObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  } catch {}
  const onError = () => {
    lastErrorAt = performance.now();
  };
  window.addEventListener('error', onError, true);
  window.addEventListener('unhandledrejection', onError, true);
  const selectorOf = (el: Element): string => {
    if (!el || !el.tagName) return '';
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
  };
  const onClick = (e: MouseEvent) => {
    try {
      const target = e.target as Element | null;
      if (!target) return;
      const now = performance.now();
      const selector = selectorOf(target);
      const row: ClickRow = { target, selector, t: now };
      while (recent.length && now - recent[0]!.t > 1000) recent.shift();
      recent.push(row);
      const sameTarget = recent.filter((r) => r.selector === selector);
      const isRage = sameTarget.length >= 3;
      const rect = (target as HTMLElement).getBoundingClientRect?.();
      const baseAttrs: Attributes = {
        [ATTR.USER_INTERACTION_TYPE]: 'click',
        [ATTR.USER_INTERACTION_TARGET_SELECTOR]: selector,
        [ATTR.USER_INTERACTION_TARGET_X]: Math.round(e.clientX),
        [ATTR.USER_INTERACTION_TARGET_Y]: Math.round(e.clientY),
        ...(rect
          ? {
              [ATTR.USER_INTERACTION_TARGET_WIDTH]: Math.round(rect.width),
              [ATTR.USER_INTERACTION_TARGET_HEIGHT]: Math.round(rect.height),
            }
          : {}),
        ...scout.commonAttributes(),
      };
      setTimeout(() => {
        const frustrations: string[] = [];
        if (isRage) frustrations.push('rage_click');
        const erroredNearby =
          Math.abs(performance.now() - lastErrorAt) < 100 ||
          Math.abs(lastErrorAt - row.t) < 100;
        if (erroredNearby) frustrations.push('error_click');
        if (frustrations.length > 0) {
          scout.emitSpan(SPAN.USER_INTERACTION, {
            ...baseAttrs,
            [ATTR.USER_INTERACTION_FRUSTRATION_TYPE]: frustrations.join(','),
          });
        }
      }, 120);
      const entry = {
        row,
        attrs: baseAttrs,
        mutated: false,
        timer: setTimeout(() => {
          const idx = pending.indexOf(entry);
          if (idx >= 0) pending.splice(idx, 1);
          if (!entry.mutated) {
            scout.emitSpan(SPAN.USER_INTERACTION, {
              ...entry.attrs,
              [ATTR.USER_INTERACTION_FRUSTRATION_TYPE]: 'dead_click',
            });
          }
        }, 600),
      };
      pending.push(entry);
    } catch {}
  };
  document.addEventListener('click', onClick, { capture: true, passive: true });
  return () => {
    document.removeEventListener('click', onClick, { capture: true });
    window.removeEventListener('error', onError, true);
    window.removeEventListener('unhandledrejection', onError, true);
    try {
      mutObserver?.disconnect();
    } catch {}
    for (const p of pending) clearTimeout(p.timer);
    pending.length = 0;
  };
}
