import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
export function installTapTracker(scout: Scout): () => void {
    if (typeof document === 'undefined')
        return () => { };
    const handler = (e: Event) => {
        try {
            const target = e.target as HTMLElement | null;
            if (!target)
                return;
            const description = describeElement(target);
            const typeName = target.tagName ? target.tagName.toLowerCase() : 'unknown';
            scout.emitSpan(SPAN.USER_INTERACTION, {
                [ATTR.USER_INTERACTION_TYPE]: 'click',
                [ATTR.USER_INTERACTION_TARGET]: description,
                [ATTR.USER_INTERACTION_TARGET_TYPE]: typeName,
                ...scout.commonAttributes(),
            });
            scout.addBreadcrumb(BREADCRUMB_TYPE.TAP, `${typeName}: ${description}`);
        }
        catch {
        }
    };
    document.addEventListener('click', handler, { capture: true, passive: true });
    return () => document.removeEventListener('click', handler, { capture: true });
}
function describeElement(el: HTMLElement): string {
    const scoutAction = el.getAttribute?.('data-scout-action') ??
        el.closest?.('[data-scout-action]')?.getAttribute('data-scout-action');
    if (scoutAction)
        return scoutAction;
    const aria = el.getAttribute?.('aria-label');
    if (aria)
        return aria;
    const id = el.id;
    if (id)
        return `#${id}`;
    const dataTest = el.getAttribute?.('data-testid') ?? el.getAttribute?.('data-test');
    if (dataTest)
        return `[data-testid=${dataTest}]`;
    const text = (el.textContent ?? '').trim().slice(0, 60);
    if (text)
        return text;
    const cls = el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : '';
    return cls ? `.${cls}` : (el.tagName?.toLowerCase() ?? 'unknown');
}
