import { Children, createElement, type ReactNode } from 'react';
import { ATTR } from '../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../core/spans';
import { withSuppression } from './soft-load';
let RN: any = null;
try {
    RN = withSuppression(() => require('react-native'));
}
catch {
}
interface ScoutTouchBoundaryProps {
    children: ReactNode;
}
export function ScoutTouchBoundary({ children }: ScoutTouchBoundaryProps) {
    if (!RN?.View) {
        return Children.only(children) as any;
    }
    const Scout = require('./index').Scout;
    return createElement(RN.View, {
        style: { flex: 1 },
        onStartShouldSetResponder: (e: any) => {
            try {
                const target = e?._targetInst ?? e?.target;
                const description = describeTouchTarget(target);
                const typeName = inferComponentName(target);
                Scout.instance?.emitSpan(SPAN.USER_INTERACTION, {
                    [ATTR.USER_INTERACTION_TYPE]: 'click',
                    [ATTR.USER_INTERACTION_TARGET]: description,
                    [ATTR.USER_INTERACTION_TARGET_TYPE]: typeName,
                    ...Scout.instance.commonAttributes(),
                });
                Scout.instance?.addBreadcrumb(BREADCRUMB_TYPE.TAP, `${typeName}: ${description}`);
            }
            catch {
            }
            return false;
        },
    }, children);
}
function describeTouchTarget(target: any): string {
    if (!target)
        return 'unknown';
    const props = target.memoizedProps ?? target.pendingProps ?? target.stateNode?.props;
    if (!props)
        return 'unknown';
    if (typeof props.accessibilityLabel === 'string' && props.accessibilityLabel) {
        return props.accessibilityLabel;
    }
    if (typeof props.testID === 'string' && props.testID) {
        return props.testID;
    }
    if (typeof props.children === 'string' && props.children) {
        return String(props.children).slice(0, 60);
    }
    return 'pressable';
}
function inferComponentName(target: any): string {
    if (!target)
        return 'unknown';
    const t = target.type;
    if (!t)
        return 'unknown';
    if (typeof t === 'string')
        return t;
    return t.displayName ?? t.name ?? 'Component';
}
