import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shared rendering parts used by `PaidGate` and `AdmiralGate`. The two
 * gates only differ in their license predicate, dismissal-storage key,
 * icon, and copy strings; everything else (the compact-blurred-lock
 * JSX, the dismissed-pill JSX, the full upsell card layout) is
 * identical. Dismissal-state logic lives in `useDismissalState` under
 * `frontend/src/hooks/`.
 *
 * These primitives let each gate compose its state machine in ~25
 * lines:
 *
 *   if (isUnlocked) return children;
 *   if (compact) return <CompactBlurredLock icon pillText>{children}</CompactBlurredLock>;
 *   if (dismissed) return <DismissedPill icon pillText onClick={restore} />;
 *   return <FullUpsellCard icon title body ctaIcon ctaLabel ctaHref onDismiss={dismiss} />;
 *
 * A future third gate (Skipper-only, or some hypothetical Enterprise
 * tier) can mix and match these without re-writing the same JSX.
 */

/**
 * Public props shape for both `PaidGate` and `AdmiralGate`. Hoisted
 * here so the `compact` doc string lives in exactly one place.
 */
export interface TierGateProps {
    children: ReactNode;
    featureName?: string;
    /**
     * Inline compact lock for list items (e.g. a single SSO provider
     * card). Skips the full-page upsell and dismiss timer; always
     * renders the blurred + pill style so the surrounding list keeps
     * its shape.
     */
    compact?: boolean;
}

/**
 * Inline list-item lock. Renders children blurred behind a small pill
 * so the surrounding list keeps its shape. Used for tiny inline UI
 * like a single SSO provider card; the IP exposure of the blurred
 * children is minor and the visual continuity is intentional.
 * Dismissal does not apply here.
 */
export function CompactBlurredLock({
    icon: Icon,
    pillText,
    children,
}: {
    icon: LucideIcon;
    pillText: string;
    children: ReactNode;
}) {
    return (
        <div className="relative">
            <div className="opacity-40 pointer-events-none select-none blur-[2px]">
                {children}
            </div>
            <div className="absolute inset-0 flex items-start justify-center pt-8">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/80 border border-border text-muted-foreground text-xs">
                    <Icon className="w-3 h-3" />
                    {pillText}
                </div>
            </div>
        </div>
    );
}

/**
 * Post-dismissal placeholder. Renders only the pill so any lazy-loaded
 * children behind a paid view never mount during the 24h dismissal
 * window. The pill is a button: clicking it calls `onClick` (typically
 * the gate's `restore` action) so the full upsell card returns and the
 * user has a way back without clearing localStorage.
 */
export function DismissedPill({
    icon: Icon,
    pillText,
    onClick,
}: {
    icon: LucideIcon;
    pillText: string;
    onClick: () => void;
}) {
    return (
        <div className="flex items-start justify-center pt-8 min-h-[200px]">
            <button
                type="button"
                onClick={onClick}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/80 border border-border text-muted-foreground text-xs hover:bg-muted hover:text-foreground transition-colors"
            >
                <Icon className="w-3 h-3" />
                {pillText}
            </button>
        </div>
    );
}

/**
 * Full-page upsell card. Centered icon chip + title + body (which can
 * carry inline links) + Dismiss / CTA actions. The CTA opens the
 * pricing page in a new tab with `noopener,noreferrer` to prevent the
 * destination from accessing `window.opener` (reverse tabnabbing).
 * Dismiss invokes `onDismiss`, which the gate uses to flip dismissal
 * state.
 */
export function FullUpsellCard({
    icon: Icon,
    title,
    body,
    ctaIcon: CtaIcon,
    ctaLabel,
    ctaHref,
    onDismiss,
}: {
    icon: LucideIcon;
    title: string;
    body: ReactNode;
    ctaIcon: LucideIcon;
    ctaLabel: string;
    ctaHref: string;
    onDismiss: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted/50 border border-border">
                <Icon className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="text-center max-w-md">
                <h3 className="text-lg font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{body}</p>
            </div>
            <div className="flex gap-3">
                <Button variant="outline" size="sm" onClick={onDismiss}>
                    Dismiss
                </Button>
                <Button size="sm" onClick={() => window.open(ctaHref, '_blank', 'noopener,noreferrer')}>
                    <CtaIcon className="w-4 h-4 mr-2" />
                    {ctaLabel}
                </Button>
            </div>
        </div>
    );
}
