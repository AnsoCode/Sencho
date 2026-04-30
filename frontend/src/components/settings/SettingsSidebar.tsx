import { NavLink } from 'react-router-dom';
import { Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { useNodes } from '@/context/NodeContext';
import { SETTINGS_GROUPS, SETTINGS_ITEMS, isItemVisible, isItemLocked } from './registry';
import type { VisibilityContext, SettingsItemMeta } from './registry';
import type { SectionId } from './types';
import { TierLockChip } from './TierLockChip';
import { cn } from '@/lib/utils';

interface SettingsSidebarProps {
    dirtyFlags?: Partial<Record<SectionId, boolean>>;
    onOpenPalette: () => void;
}

export function SettingsSidebar({ dirtyFlags, onOpenPalette }: SettingsSidebarProps) {
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

    function isVisible(item: SettingsItemMeta): boolean {
        return isItemVisible(item, visibility);
    }

    return (
        <aside className="w-[240px] rounded-xl border border-card-border bg-card flex flex-col shrink-0 min-h-0 overflow-hidden">
            <div className="px-3 pt-5 pb-2">
                <button
                    onClick={onOpenPalette}
                    className="flex w-full items-center gap-2 rounded-md border border-glass-border bg-glass px-2.5 py-1.5 text-xs text-stat-subtitle transition-colors hover:border-brand/30 hover:text-stat-value"
                >
                    <Search className="h-3 w-3 shrink-0" />
                    <span className="flex-1 text-left">Filter</span>
                    <kbd className="font-mono text-[9px] uppercase tracking-[0.18em] text-stat-subtitle/70 border border-card-border rounded px-1 py-px">
                        ⌘K
                    </kbd>
                </button>
            </div>

            <ScrollArea className="flex-1 px-3">
                <nav className="pb-4">
                    {SETTINGS_GROUPS.map(group => {
                        const groupItems = SETTINGS_ITEMS.filter(
                            item => item.group === group.id && isVisible(item),
                        );

                        if (groupItems.length === 0) return null;

                        const unlockedCount = groupItems.filter(
                            item => !isItemLocked(item, visibility),
                        ).length;

                        return (
                            <div key={group.id} className="mb-1 mt-3">
                                <div className="mb-1 flex items-center justify-between gap-2 px-2">
                                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stat-subtitle/70">
                                        {group.label}
                                    </span>
                                    <span className="font-mono text-[10px] tabular-nums text-stat-subtitle/50">
                                        {unlockedCount}/{groupItems.length}
                                    </span>
                                </div>
                                {groupItems.map(item => {
                                    const locked = isItemLocked(item, visibility);
                                    const isDirty = dirtyFlags?.[item.id] ?? false;

                                    return (
                                        <NavLink
                                            key={item.id}
                                            to={`/settings/${item.id}`}
                                            className={({ isActive }) =>
                                                cn(
                                                    'relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                                                    isActive
                                                        ? 'text-stat-value'
                                                        : 'text-stat-subtitle hover:bg-accent/40 hover:text-stat-value',
                                                    locked && 'opacity-60',
                                                )
                                            }
                                        >
                                            {({ isActive }) => (
                                                <>
                                                    {isActive && (
                                                        <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-brand" />
                                                    )}
                                                    <span
                                                        aria-hidden="true"
                                                        className={cn(
                                                            'h-1 w-1 shrink-0 rounded-full',
                                                            isActive ? 'bg-brand' : 'bg-stat-subtitle/40',
                                                        )}
                                                    />
                                                    <span className="flex-1 truncate">{item.label}</span>
                                                    {isDirty && (
                                                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                                                    )}
                                                    {item.tier && locked && <TierLockChip tier={item.tier} showIcon={false} />}
                                                </>
                                            )}
                                        </NavLink>
                                    );
                                })}
                            </div>
                        );
                    })}
                </nav>
            </ScrollArea>
        </aside>
    );
}
