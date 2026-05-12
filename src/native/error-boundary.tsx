import { Component, createElement, type ErrorInfo, type ReactNode } from 'react';
import { ATTR } from '../core/attributes';
import { SPAN, BREADCRUMB_TYPE } from '../core/spans';
import { withSuppression } from './soft-load';
let RN: any = null;
try {
    RN = withSuppression(() => require('react-native'));
}
catch {
}
interface BoundaryProps {
    children: ReactNode;
    fallback?: ReactNode | ((error: Error) => ReactNode);
    fatal?: boolean;
}
interface BoundaryState {
    error: Error | null;
}
export class ScoutErrorBoundary extends Component<BoundaryProps, BoundaryState> {
    override state: BoundaryState = { error: null };
    static getDerivedStateFromError(error: Error): BoundaryState {
        return { error };
    }
    override componentDidCatch(error: Error, info: ErrorInfo): void {
        const Scout = require('./index').Scout;
        Scout.reportError(error, {
            handled: !this.props.fatal,
            library: 'react-native',
            componentStack: info.componentStack ?? undefined,
        });
        const firstFrame = info.componentStack?.split('\n')[1]?.trim();
        Scout.addBreadcrumb('error', firstFrame ?? 'render');
    }
    override render(): ReactNode {
        if (this.state.error) {
            const { fallback } = this.props;
            if (typeof fallback === 'function')
                return fallback(this.state.error);
            if (fallback !== undefined)
                return fallback;
            if (RN?.View && RN?.Text) {
                return createElement(RN.View, { style: { flex: 1, padding: 16, justifyContent: 'center' } }, createElement(RN.Text, { style: { fontSize: 16, fontWeight: '600' } }, 'Something went wrong'), createElement(RN.Text, { style: { marginTop: 8, color: '#666' } }, this.state.error.message));
            }
            return null;
        }
        return this.props.children;
    }
}
export class ScoutRootBoundary extends Component<BoundaryProps, BoundaryState> {
    override state: BoundaryState = { error: null };
    static getDerivedStateFromError(error: Error): BoundaryState {
        return { error };
    }
    override componentDidCatch(error: Error, info: ErrorInfo): void {
        const Scout = require('./index').Scout;
        Scout.reportError(error, {
            handled: !this.props.fatal,
            library: 'react-native',
            componentStack: info.componentStack ?? undefined,
        });
        const firstFrame = info.componentStack?.split('\n')[1]?.trim();
        Scout.addBreadcrumb('error', firstFrame ?? 'render');
    }
    private handleStartShouldSetResponder = (e: any): boolean => {
        try {
            const Scout = require('./index').Scout;
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
    };
    override render(): ReactNode {
        if (this.state.error) {
            if (RN?.View && RN?.Text) {
                return createElement(RN.View, { style: { flex: 1, padding: 16, justifyContent: 'center' } }, createElement(RN.Text, { style: { fontSize: 16, fontWeight: '600' } }, 'Something went wrong'), createElement(RN.Text, { style: { marginTop: 8, color: '#666' } }, this.state.error.message));
            }
            return null;
        }
        if (!RN?.View) {
            return this.props.children as ReactNode;
        }
        return createElement(RN.View, {
            style: { flex: 1 },
            onStartShouldSetResponder: this.handleStartShouldSetResponder,
        }, this.props.children);
    }
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
