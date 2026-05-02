import { Compass } from 'lucide-react';
import { useLicense } from '@/context/LicenseContext';
import { useDismissalState } from '@/hooks/useDismissalState';
import {
    CompactBlurredLock,
    DismissedPill,
    FullUpsellCard,
    type TierGateProps,
} from './tierUpsell';

const DISMISS_KEY = 'sencho-upgrade-prompt-dismissed';

/**
 * Gate for any paid-tier feature (Skipper or Admiral). Composes the
 * shared tier-upsell primitives in `./tierUpsell` according to the
 * current state:
 *
 *   isPaid             render children (unlocked).
 *   compact            blurred children + small pill (inline list items).
 *   dismissed          pill-only placeholder for 24h, click to restore.
 *   default            full upsell card with View Plans CTA.
 *
 * The compact branch retains the blurred-children render because it is
 * used for tiny inline UI where the visual continuity is intentional.
 * The dismissed and default branches do not render children, so any
 * lazy chunks behind the gate are never fetched on those paths.
 */
export function PaidGate({ children, featureName = 'This feature', compact = false }: TierGateProps) {
    const { isPaid } = useLicense();
    const { dismissed, dismiss, restore } = useDismissalState(DISMISS_KEY);

    if (isPaid) return <>{children}</>;

    const pillText = `Upgrade to unlock ${featureName}`;

    if (compact) {
        return (
            <CompactBlurredLock icon={Compass} pillText={pillText}>
                {children}
            </CompactBlurredLock>
        );
    }

    if (dismissed) {
        return <DismissedPill icon={Compass} pillText={pillText} onClick={restore} />;
    }

    return (
        <FullUpsellCard
            icon={Compass}
            title={`${featureName} requires a paid license`}
            body={
                <>
                    Unlock features like fleet management, viewer accounts, one-click Google / GitHub / Okta SSO, and more with a Skipper or Admiral license.
                    For enterprise pricing or questions, contact{' '}
                    <a href="mailto:licensing@sencho.io" className="text-brand hover:underline">licensing@sencho.io</a>.
                </>
            }
            ctaIcon={Compass}
            ctaLabel="View Plans"
            ctaHref="https://sencho.io/pricing"
            onDismiss={dismiss}
        />
    );
}
