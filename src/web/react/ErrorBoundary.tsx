import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Scout } from '../index';
interface Props {
    children: ReactNode;
    fallback?: ReactNode | ((error: Error) => ReactNode);
    fatal?: boolean;
}
interface State {
    error: Error | null;
}
export class ScoutErrorBoundary extends Component<Props, State> {
    override state: State = { error: null };
    static getDerivedStateFromError(error: Error): State {
        return { error };
    }
    override componentDidCatch(error: Error, info: ErrorInfo): void {
        Scout.reportError(error, {
            handled: !this.props.fatal,
            library: 'react',
        });
        Scout.addBreadcrumb('error', info.componentStack?.split('\n')[1]?.trim() ?? 'render');
    }
    override render(): ReactNode {
        if (this.state.error) {
            const { fallback } = this.props;
            if (typeof fallback === 'function')
                return fallback(this.state.error);
            return fallback ?? null;
        }
        return this.props.children;
    }
}
