import { NavLink, useNavigate } from 'react-router-dom';
import { ChevronLeft, Lock, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { useNodes } from '@/context/NodeContext';
import { SETTINGS_GROUPS, SETTINGS_ITEMS, isItemVisible, isItemLocked } from './registry';
import type { VisibilityContext, SettingsItemMeta } from './registry';
import type { SectionId } from './types';
import { cn } from '@/lib/utils';

interface TierChipProps {
    tier: 'skipper' | 'admiral';
}

function TierChip({ tier }: TierChipProps) {
    return (
        <span
            className={cn(
                'ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                tier === 'admiral'
                    ? 'bg-warning/15 text-warning'
                    : 'bg-brand/15 text-brand',
            )}
        >
            {tier === 'admiral' ? 'Admiral' : 'Skipper'}
        </span>
    );
}

interface SettingsSidebarProps {
    dirtyFlags?: Partial<Record<SectionId, boolean>>;
    onOpenPalette: () => void;
}

export function SettingsSidebar({ dirtyFlags, onOpenPalette }: SettingsSidebarProps) {
    const navigate = useNavigate();
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

    const nodeName = activeNode?.name ?? 'control plane';

    function handleBack() {
        if (window.history.length <= 1) {
            navigate('/');
        } else {
            navigate(-1);
        }
    }

    function isVisible(item: SettingsItemMeta): boolean {
        return isItemVisible(item, visibility);
    }

    return (
        <aside className="w-[220px] bg-glass border-r border-glass-border flex flex-col shrink-0 min-h-0">
            <div className="flex items-center gap-2 px-4 pt-5 pb-3">
                <button
                    onClick={handleBack}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stat-subtitle transition-colors hover:bg-accent/40 hover:text-stat-value"
                    aria-label="Go back"
                >
                    <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
                <div className="min-w-0 flex-1">
                    <p className="font-display italic text-xl leading-tight text-stat-value">Settings</p>
                    <p className="truncate text-[11px] text-stat-subtitle">{nodeName}</p>
                </div>
            </div>

            <div className="px-3 pb-2">
                <button
                    onClick={onOpenPalette}
                    className="flex w-full items-center gap-2 rounded-md border border-glass-border bg-glass px-3 py-1.5 text-xs text-stat-subtitle transition-colors hover:border-brand/30 hover:text-stat-value"
                >
                    <Search className="h-3 w-3 shrink-0" />
                    <span className="flex-1 text-left">Filter settings</span>
                </button>
            </div>

            <ScrollArea className="flex-1 px-3">
                <nav className="pb-4">
                    {SETTINGS_GROUPS.map(group => {
                        const items = SETTINGS_ITEMS.filter(
                            item => item.group === group.id && isVisible(item),
                        );

                        if (items.length === 0) return null;

                        return (
                            <div key={group.id} className="mb-1 mt-3">
                                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-stat-subtitle/60">
                                    {group.label}
                                </p>
                                {items.map(item => {
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
                                                        ? 'bg-gradient-to-r from-brand/10 to-transparent text-stat-value'
                                                        : 'text-stat-subtitle hover:bg-accent/40 hover:text-stat-value',
                                                )
                                            }
                                        >
                                            {({ isActive }) => (
                                                <>
                                                    {isActive && (
                                                        <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-brand" />
                                                    )}
                                                    <span className="flex-1 truncate">{item.label}</span>
                                                    {isDirty && (
                                                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                                                    )}
                                                    {locked && <Lock className="h-3 w-3 shrink-0 text-stat-subtitle/60" />}
                                                    {item.tier && !locked && (
                                                        <TierChip tier={item.tier} />
                                                    )}
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
