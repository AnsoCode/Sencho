import { Component, createRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * App-level catch-all error boundary. Sits above feature-specific
 * boundaries (e.g. `LazyBoundary` around `<Suspense>` blocks) so any
 * uncaught render error in a non-lazy subtree still produces a
 * consistent recovery card instead of a blank page.
 *
 * Visually matches `LazyBoundary`: glass card, AlertTriangle icon,
 * single Try-again CTA. The shared aesthetic is intentional so a user
 * never sees two different "something went wrong" treatments depending
 * on which boundary catches the error.
 *
 * "Try again" resets the boundary's state, which causes React to
 * re-render the children. For deterministic errors this just shows the
 * card again, which is the expected behavior of any error boundary;
 * for transient errors (stale API response, race) it can recover
 * cleanly.
 */
class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    /**
     * Ref on the CTA button so we can focus it when the boundary trips.
     * When a render error fires, focus is typically inside the now-
     * unmounted subtree and falls back to <body>; keyboard users would
     * otherwise have to tab from the top to reach the recovery action.
     */
    private ctaRef = createRef<HTMLButtonElement>();

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    public componentDidUpdate(_prevProps: Props, prevState: State) {
        if (!prevState.hasError && this.state.hasError) {
            this.ctaRef.current?.focus();
        }
    }

    public render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="flex flex-1 items-center justify-center min-h-[280px] p-8" role="alert">
                <div className="flex flex-col items-center gap-4 rounded-xl border border-glass-border bg-glass px-10 py-8 text-center max-w-md">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full border border-glass-border bg-glass">
                        <AlertTriangle className="w-5 h-5 text-stat-subtitle" strokeWidth={1.5} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-semibold text-stat-value">Something went wrong</p>
                        <p className="text-sm text-stat-subtitle">{this.state.error?.message || 'Unknown error'}</p>
                    </div>
                    <Button
                        ref={this.ctaRef}
                        variant="outline"
                        size="sm"
                        onClick={() => this.setState({ hasError: false, error: null })}
                    >
                        Try again
                    </Button>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
