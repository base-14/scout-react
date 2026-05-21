import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { uuidv4 } from '../../core/uuid';
export function installTapTracker(scout: Scout): () => void {
  if (typeof document === 'undefined') return () => {};
  const handler = (e: MouseEvent) => {
    try {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const { description, source } = describeElement(target);
      const typeName = target.tagName ? target.tagName.toLowerCase() : 'unknown';
      const rect = target.getBoundingClientRect?.();
      scout.emitSpan(SPAN.USER_INTERACTION, {
        [ATTR.USER_INTERACTION_ID]: uuidv4(),
        [ATTR.USER_INTERACTION_TYPE]: 'click',
        [ATTR.USER_INTERACTION_TARGET]: description,
        [ATTR.USER_INTERACTION_TARGET_TYPE]: typeName,
        [ATTR.USER_INTERACTION_TARGET_NAME_SOURCE]: source,
        [ATTR.USER_INTERACTION_TARGET_SELECTOR]: cssSelectorOf(target),
        [ATTR.USER_INTERACTION_TARGET_COMPOSED_PATH_SELECTOR]: composedPathSelector(e),
        [ATTR.USER_INTERACTION_TARGET_X]: Math.round(e.clientX),
        [ATTR.USER_INTERACTION_TARGET_Y]: Math.round(e.clientY),
        ...(rect
          ? {
              [ATTR.USER_INTERACTION_TARGET_WIDTH]: Math.round(rect.width),
              [ATTR.USER_INTERACTION_TARGET_HEIGHT]: Math.round(rect.height),
            }
          : {}),
        ...scout.commonAttributes(),
      });
      scout.addBreadcrumb(BREADCRUMB_TYPE.TAP, `${typeName}: ${description}`);
    } catch {}
  };
  document.addEventListener('click', handler, { capture: true, passive: true });
  return () => document.removeEventListener('click', handler, { capture: true });
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
  const text = (el.textContent ?? '').trim().slice(0, 60);
  if (text) return { description: text, source: 'text_content' };
  const cls =
    el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : '';
  if (cls) return { description: `.${cls}`, source: 'standard_attribute' };
  return { description: el.tagName?.toLowerCase() ?? 'unknown', source: 'blank' };
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
