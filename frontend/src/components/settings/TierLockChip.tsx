import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TierLockTier = 'skipper' | 'admiral';

interface TierLockChipProps {
    tier: TierLockTier;
    showIcon?: boolean;
    className?: string;
}

export function TierLockChip({ tier, showIcon = true, className }: TierLockChipProps) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-sm border border-card-border bg-card px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-stat-subtitle/80',
                className,
            )}
        >
            {showIcon && <Lock className="h-2.5 w-2.5" strokeWidth={1.5} />}
            {tier === 'admiral' ? 'Admiral' : 'Skipper'}
        </span>
    );
}
