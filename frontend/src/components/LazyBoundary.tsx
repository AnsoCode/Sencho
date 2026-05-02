import { Component } from 'react';
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
 * Recognises the error messages browsers throw when a dynamically-imported
 * chunk URL is no longer reachable. Each runtime worded the failure
 * differently, so the heuristic is a substring union rather than a single
 * regex; broadening to a generic "module + fail" match would over-fire on
 * legitimate runtime errors and route them to a misleading Reload CTA.
 *
 * Currently covered:
 *   - Chrome / Edge:  "Failed to fetch dynamically imported module: <url>"
 *   - Safari:         "Importing a module script failed."
 *   - Firefox:        "Loading module from \"<url>\" was blocked because of a disallowed MIME type (\"text/html\")."
 *                     (fired when a deploy serves the SPA index.html for a missing chunk URL)
 *   - Older Webpack:  "Error loading dynamically imported module"
 *   - Vite:           "Loading chunk N failed." / "Loading CSS chunk N failed"
 *
 * Add new substrings here as new browser variants surface; cover them in
 * the matching unit test so a regression in one runtime is caught early.
 */
export function isChunkLoadError(error: Error | null | undefined): boolean {
    if (!error) return false;
    const msg = error.message.toLowerCase();
    return (
        msg.includes('failed to fetch dynamically imported module') ||
        msg.includes('importing a module script failed') ||
        msg.includes('error loading dynamically imported module') ||
        msg.includes('disallowed mime type') ||
        msg.includes('loading chunk') ||
        msg.includes('loading css chunk')
    );
}

/**
 * Specialized error boundary for lazy-loaded subtrees. Catches errors
 * thrown during chunk fetch and renders a small card inviting the user
 * to reload. Reload is the actual remedy because the stale tab is asking
 * for chunk URLs that the deployed bundle no longer emits; a "Try again"
 * against the same URL would just fail again.
 *
 * For non-chunk runtime errors (the lazy module loaded but threw during
 * render) the boundary falls back to a "Try again" CTA that resets state
 * and re-renders the children. This is safe because the lazy import has
 * already resolved on this path, so re-rendering does not re-trigger a
 * chunk fetch; if the underlying error is non-deterministic (e.g. a stale
 * API response) the retry can succeed. If the error is deterministic the
 * card just reappears, which is the expected behavior of any boundary.
 *
 * Sized via min-h-[280px] to look at home in both the workspace area
 * and inline-section contexts that wrap lazy components.
 */
class LazyBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('LazyBoundary caught an error:', error, errorInfo);
    }

    public render() {
        if (!this.state.hasError) return this.props.children;

        const isChunk = isChunkLoadError(this.state.error);
        const title = isChunk ? 'This part of Sencho needs a reload' : 'Something went wrong';
        const body = isChunk
            ? 'A newer version may have shipped while this tab was open. Reload to fetch the latest.'
            : this.state.error?.message || 'Unknown error';
        const ctaLabel = isChunk ? 'Reload' : 'Try again';
        const onCta = isChunk
            ? () => window.location.reload()
            : () => this.setState({ hasError: false, error: null });

        return (
            <div className="flex flex-1 items-center justify-center min-h-[280px] p-8" role="alert">
                <div className="flex flex-col items-center gap-4 rounded-xl border border-glass-border bg-glass px-10 py-8 text-center max-w-md">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full border border-glass-border bg-glass">
                        <AlertTriangle className="w-5 h-5 text-stat-subtitle" strokeWidth={1.5} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-semibold text-stat-value">{title}</p>
                        <p className="text-sm text-stat-subtitle">{body}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={onCta}>
                        {ctaLabel}
                    </Button>
                </div>
            </div>
        );
    }
}

export default LazyBoundary;
