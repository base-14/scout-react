// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scout } from '../../core/scout';
import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import { makeRecorder, memoryPlatform, type Recorder } from '../../test/recorder';
import { installTapTracker } from './tap';
describe('installTapTracker', () => {
    let recorder: Recorder;
    let scout: Scout;
    let dispose: () => void;
    beforeEach(async () => {
        document.body.innerHTML = '';
        recorder = makeRecorder();
        scout = new Scout({ serviceName: 't', endpoint: 'http://localhost', secure: false }, memoryPlatform());
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
        expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('add-to-cart');
    });
    it('prefers data-scout-action over aria-label', () => {
        const btn = document.createElement('button');
        btn.setAttribute('data-scout-action', 'checkout-cta');
        btn.setAttribute('aria-label', 'pay');
        btn.textContent = 'Pay';
        document.body.appendChild(btn);
        click(btn);
        expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('checkout-cta');
    });
    it('walks up the DOM to find an ancestor data-scout-action', () => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-scout-action', 'wrapper-action');
        const inner = document.createElement('span');
        inner.textContent = 'click me';
        wrapper.appendChild(inner);
        document.body.appendChild(wrapper);
        click(inner);
        expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('wrapper-action');
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
    it('falls back to id then className then tag name', () => {
        const a = document.createElement('button');
        a.id = 'pay-now';
        document.body.appendChild(a);
        click(a);
        expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('#pay-now');
        recorder.reset();
        const b = document.createElement('button');
        b.className = 'btn-primary other';
        document.body.appendChild(b);
        click(b);
        expect(recorder.spans()[0]?.attributes[ATTR.USER_INTERACTION_TARGET]).toBe('.btn-primary');
    });
});
