import { ATTR } from '../../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../../core/spans';
import type { Scout } from '../../core/scout';
import { uuidv4 } from '../../core/uuid';
import { withSuppression } from '../soft-load';
let React: any = null;
try {
    React = withSuppression(() => require('react'));
}
catch {
}
let observeTap: ((args: any[]) => void) | null = null;
let _patched = false;
function patchCreateElement(originalFn: any, args: any[]): any {
    const props = args[1];
    if (props && typeof (props as any).onPress === 'function') {
        const originalOnPress = (props as any).onPress;
        if (!originalOnPress.__scoutWrapped) {
            (props as any).onPress = (...callArgs: any[]) => {
                try {
                    observeTap?.(callArgs);
                }
                catch {
                }
                return originalOnPress(...callArgs);
            };
            (props as any).onPress.__scoutWrapped = true;
            (props as any).__SCOUT_ORIGINAL_ON_PRESS = originalOnPress;
        }
    }
    return originalFn(...args);
}
function getJsxRuntimes(): [
    any | null,
    any | null
] {
    let jsxRt: any = null;
    let jsxDevRt: any = null;
    try {
        jsxRt = withSuppression(() => require('react/jsx-runtime'));
    }
    catch {
    }
    try {
        jsxDevRt = withSuppression(() => require('react/jsx-dev-runtime'));
    }
    catch {
    }
    return [jsxRt, jsxDevRt];
}
function installCreateElementPatch(): void {
    if (_patched || !React)
        return;
    _patched = true;
    const origCreateElement = React.createElement;
    React.createElement = function (...args: any[]) {
        return patchCreateElement(origCreateElement, args);
    };
    const [jsxRt, jsxDevRt] = getJsxRuntimes();
    if (jsxRt?.jsx) {
        const origJsx = jsxRt.jsx;
        jsxRt.jsx = function (...args: any[]) {
            return patchCreateElement(origJsx, args);
        };
    }
    if (jsxRt?.jsxs) {
        const origJsxs = jsxRt.jsxs;
        jsxRt.jsxs = function (...args: any[]) {
            return patchCreateElement(origJsxs, args);
        };
    }
    if (jsxDevRt?.jsxDEV) {
        const origJsxDev = jsxDevRt.jsxDEV;
        jsxDevRt.jsxDEV = function (...args: any[]) {
            return patchCreateElement(origJsxDev, args);
        };
    }
}
installCreateElementPatch();
function emitTapSpan(scout: Scout, target: {
    componentName?: string;
    accessibilityLabel?: string;
    testID?: string;
    children?: string;
}, args: any[]): void {
    const event = resolveNativeEvent(args);
    const inst = event?._targetInst;
    const ne = event?.nativeEvent;
    const description = target.accessibilityLabel ||
        target.testID ||
        target.children ||
        (inst ? resolveTargetName(inst).description : 'unknown_target');
    let source: string;
    if (target.accessibilityLabel)
        source = 'standard_attribute';
    else if (target.testID)
        source = 'standard_attribute';
    else if (target.children)
        source = 'text_content';
    else if (inst)
        source = resolveTargetName(inst).source;
    else
        source = 'blank';
    const typeName = target.componentName ?? (inst ? resolveTargetType(inst) : 'unknown');
    scout.emitSpan(SPAN.USER_INTERACTION, {
        [ATTR.USER_INTERACTION_ID]: uuidv4(),
        [ATTR.USER_INTERACTION_TYPE]: 'tap',
        [ATTR.USER_INTERACTION_TARGET]: description,
        [ATTR.USER_INTERACTION_TARGET_TYPE]: typeName,
        [ATTR.USER_INTERACTION_TARGET_NAME_SOURCE]: source,
        [ATTR.USER_INTERACTION_TARGET_PERMANENT_ID]: inst ? targetPermanentId(inst) : '',
        ...(typeof ne?.locationX === 'number'
            ? { [ATTR.USER_INTERACTION_TARGET_X]: Math.round(ne.locationX) }
            : {}),
        ...(typeof ne?.locationY === 'number'
            ? { [ATTR.USER_INTERACTION_TARGET_Y]: Math.round(ne.locationY) }
            : {}),
        ...scout.commonAttributes(),
    });
    scout.addBreadcrumb(BREADCRUMB_TYPE.TAP, `${typeName}: ${description}`);
}
function resolveTargetName(targetNode: any): {
    description: string;
    source: string;
} {
    let cur: any = targetNode;
    let depth = 0;
    let firstStringChild: string | null = null;
    while (cur && depth < 16) {
        const props = cur.memoizedProps ?? cur.pendingProps;
        if (props) {
            if (typeof props.accessibilityLabel === 'string' && props.accessibilityLabel) {
                return { description: props.accessibilityLabel, source: 'standard_attribute' };
            }
            if (typeof props.testID === 'string' && props.testID) {
                return { description: props.testID, source: 'standard_attribute' };
            }
            if (firstStringChild == null &&
                typeof props.children === 'string' &&
                props.children) {
                firstStringChild = String(props.children).slice(0, 60);
            }
        }
        cur = cur.return;
        depth++;
    }
    if (firstStringChild)
        return { description: firstStringChild, source: 'text_content' };
    return { description: 'unknown_target', source: 'blank' };
}
function resolveTargetType(targetNode: any): string {
    let cur: any = targetNode;
    let depth = 0;
    let hostName: string | null = null;
    while (cur && depth < 16) {
        const t = cur.elementType ?? cur.type;
        if (t) {
            if (typeof t === 'string') {
                if (!hostName)
                    hostName = t;
            }
            else {
                const name = t.displayName || t.name || t.render?.displayName || t.render?.name;
                if (name)
                    return name;
            }
        }
        cur = cur.return;
        depth++;
    }
    return hostName ?? 'unknown';
}
function targetPermanentId(targetNode: any): string {
    try {
        const parts: string[] = [];
        let cur: any = targetNode;
        let depth = 0;
        while (cur && depth < 12) {
            const t = cur.elementType ?? cur.type;
            if (t) {
                const name = typeof t === 'string'
                    ? t
                    : t.displayName || t.name || t.render?.displayName || t.render?.name || '?';
                parts.unshift(name);
            }
            cur = cur.return;
            depth++;
        }
        const chain = parts.join('>');
        let h = 5381;
        for (let i = 0; i < chain.length; i++) {
            h = (h * 33) ^ chain.charCodeAt(i);
        }
        return (h >>> 0).toString(16);
    }
    catch {
        return '';
    }
}
export function installNativeTapTracker(scout: Scout): () => void {
    observeTap = (callArgs: any[]) => {
        const event = resolveNativeEvent(callArgs);
        if (!event)
            return;
        emitTapSpan(scout, {}, callArgs);
        if (event)
            (event as any).__scoutTapRecorded = true;
    };
    const g: any = globalThis;
    g.__scoutTap = (target: {
        componentName?: string;
        accessibilityLabel?: string;
        testID?: string;
        children?: string;
    }, args: any[]) => {
        const event = resolveNativeEvent(args);
        if (event && (event as any).__scoutTapRecorded)
            return;
        emitTapSpan(scout, target, args);
        if (event)
            (event as any).__scoutTapRecorded = true;
    };
    return () => {
        observeTap = null;
        if (g.__scoutTap)
            delete g.__scoutTap;
    };
}
function resolveNativeEvent(args: any[]): any | null {
    if (!args || args.length === 0 || !args[0])
        return null;
    if (args[0]._targetInst)
        return args[0];
    if (args[0].event && args[0].event._targetInst)
        return args[0].event;
    return null;
}
