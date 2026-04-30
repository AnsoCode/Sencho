import React from 'react';
import { Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { useNodes } from '@/context/NodeContext';
import { getSettingsItem, isItemVisible, isItemLocked } from './registry';
import type { VisibilityContext } from './registry';
import type { SectionId } from './types';

interface TierLockedCardProps {
    tier: 'skipper' | 'admiral';
}

function TierLockedCard({ tier }: TierLockedCardProps) {
    const title = tier === 'admiral' ? 'Admiral feature' : 'Skipper feature';

    return (
        <div className="flex flex-1 items-center justify-center p-8">
            <div className="flex flex-col items-center gap-4 rounded-xl border border-glass-border bg-glass px-10 py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-glass-border bg-glass">
                    <Lock className="h-5 w-5 text-stat-subtitle" />
                </div>
                <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-stat-value">{title}</p>
                    <p className="text-sm text-stat-subtitle">Upgrade to unlock more features.</p>
                </div>
            </div>
        </div>
    );
}

interface SectionGateProps {
    sectionId: SectionId;
    children: React.ReactNode;
}

export function SectionGate({ sectionId, children }: SectionGateProps) {
    const { isAdmin } = useAuth();
    const { isPaid, license } = useLicense();
    const { activeNode } = useNodes();

    const isAdmiral = isPaid && license?.variant === 'admiral';
    const isRemote = activeNode?.type === 'remote';

    const visibility: VisibilityContext = {
        isAdmin,
        isPaid,
        isAdmiral,
        isRemote,
    };

    const item = getSettingsItem(sectionId);

    // SettingsPage routes invisible sections back to a visible default before this
    // component renders, so reaching this branch means the registry shape changed
    // mid-session. Render nothing rather than throw — SettingsPage's effect will
    // resolve to a valid section on the next tick.
    if (!item || !isItemVisible(item, visibility)) return null;

    if (isItemLocked(item, visibility) && (item.tier === 'skipper' || item.tier === 'admiral')) {
        return <TierLockedCard tier={item.tier} />;
    }

    return <>{children}</>;
}
