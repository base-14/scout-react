import { Component, createElement, type ErrorInfo, type ReactNode } from 'react';
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
        return this.props.children as ReactNode;
    }
}
