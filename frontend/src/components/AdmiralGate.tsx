import { ShipWheel } from 'lucide-react';
import { useLicense } from '@/context/LicenseContext';
import { useDismissalState } from '@/hooks/useDismissalState';
import {
    CompactBlurredLock,
    DismissedPill,
    FullUpsellCard,
    type TierGateProps,
} from './tierUpsell';

const DISMISS_KEY = 'sencho-admiral-upgrade-prompt-dismissed';

/**
 * Gate for Admiral-tier-only features. Mirrors PaidGate's state machine
 * but with a stricter license predicate (requires variant === 'admiral')
 * and Admiral-themed icon/copy.
 */
export function AdmiralGate({ children, featureName = 'This feature', compact = false }: TierGateProps) {
    const { isPaid, license } = useLicense();
    const { dismissed, dismiss, restore } = useDismissalState(DISMISS_KEY);

    if (isPaid && license?.variant === 'admiral') return <>{children}</>;

    const pillText = 'Upgrade to Admiral to unlock';

    if (compact) {
        return (
            <CompactBlurredLock icon={ShipWheel} pillText={pillText}>
                {children}
            </CompactBlurredLock>
        );
    }

    if (dismissed) {
        return <DismissedPill icon={ShipWheel} pillText={pillText} onClick={restore} />;
    }

    return (
        <FullUpsellCard
            icon={ShipWheel}
            title={`${featureName} requires Sencho Admiral`}
            body={
                <>
                    Unlock team features like LDAP / Active Directory, audit logging, API tokens, and unlimited user accounts with a Sencho Admiral license.
                    For enterprise pricing or questions, contact{' '}
                    <a href="mailto:licensing@sencho.io" className="text-brand hover:underline">licensing@sencho.io</a>.
                </>
            }
            ctaIcon={ShipWheel}
            ctaLabel="Get Admiral"
            ctaHref="https://sencho.io/pricing"
            onDismiss={dismiss}
        />
    );
}
