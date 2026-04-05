import { Compass, Globe, ShipWheel } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useLicense, type LicenseTier, type LicenseVariant, type LicenseStatus } from '@/context/LicenseContext';

interface TierBadgeProps {
    tier?: LicenseTier;
    variant?: LicenseVariant;
    status?: LicenseStatus;
    className?: string;
}

const tierConfig = {
    community: { icon: Globe, label: 'Community' },
    skipper: { icon: Compass, label: 'Skipper' },
    admiral: { icon: ShipWheel, label: 'Admiral' },
} as const;

function resolveTier(tier: LicenseTier, variant: LicenseVariant, status: LicenseStatus) {
    // Only show Admiral badge for active admiral licenses (trials default to skipper)
    if (tier === 'paid' && variant === 'admiral' && status === 'active') return tierConfig.admiral;
    if (tier === 'paid') return tierConfig.skipper;
    return tierConfig.community;
}

export function TierBadge({ tier, variant, status, className }: TierBadgeProps) {
    const { license } = useLicense();
    const resolvedTier = tier ?? license?.tier ?? 'community';
    const resolvedVariant = variant !== undefined ? variant : license?.variant ?? null;
    const resolvedStatus = status ?? license?.status ?? 'community';
    const { icon: Icon, label } = resolveTier(resolvedTier, resolvedVariant, resolvedStatus);

    return (
        <Badge variant="secondary" className={`gap-1 text-[10px] font-semibold uppercase px-1.5 py-0 ${className || ''}`}>
            <Icon className="w-2.5 h-2.5" />
            {label}
        </Badge>
    );
}
