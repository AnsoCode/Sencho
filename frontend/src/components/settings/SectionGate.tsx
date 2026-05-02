import React from 'react';
import { Lock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { useNodes } from '@/context/NodeContext';
import { getSettingsItem, isItemVisible, isItemLocked } from './registry';
import type { VisibilityContext } from './registry';
import type { SectionId } from './types';
import { LockCard } from '../ui/LockCard';

interface TierLockedCardProps {
    tier: 'skipper' | 'admiral';
}

function TierLockedCard({ tier }: TierLockedCardProps) {
    const title = tier === 'admiral' ? 'Admiral feature' : 'Skipper feature';
    return (
        <LockCard icon={Lock} title={title} body="Upgrade to unlock more features." />
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
