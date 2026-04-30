import { useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { PageMasthead, type MastheadMetadataItem } from '@/components/ui/PageMasthead';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { useNodes } from '@/context/NodeContext';
import { NodeManager } from '../NodeManager';
import { SSOSection } from '../SSOSection';
import { ApiTokensSection } from '../ApiTokensSection';
import { RegistriesSection } from '../RegistriesSection';
import {
    AccountSection,
    AppearanceSection,
    LicenseSection,
    UsersSection,
    SystemSection,
    NotificationsSection,
    NotificationRoutingSection,
    WebhooksSection,
    SecuritySection,
    CloudBackupSection,
    DeveloperSection,
    AppStoreSection,
    SupportSection,
    AboutSection,
    LabelsSection,
    SETTINGS_ITEMS,
    SETTINGS_GROUPS,
    getSettingsItem,
    getSettingsGroup,
    isItemVisible,
    isItemLocked,
} from './index';
import type { SectionId, SettingsItemMeta, VisibilityContext } from './index';
import { SectionGate } from './SectionGate';
import { SettingsSidebar } from './SettingsSidebar';
import { MastheadStatsProvider, useMastheadStatsValue } from './MastheadStatsContext';
import { TierLockChip } from './TierLockChip';
import { cn } from '@/lib/utils';

export function SettingsPage() {
    return (
        <MastheadStatsProvider>
            <SettingsPageInner />
        </MastheadStatsProvider>
    );
}

function SettingsPageInner() {
    const { sectionId } = useParams<{ sectionId: string }>();
    // Derive currentSection from the registry item itself (trusted data), not from the raw
    // URL param, so the tainted sectionId string never reaches a property write.
    const currentSection: SectionId = (SETTINGS_ITEMS.find(i => i.id === sectionId)?.id) ?? 'appearance';

    const contentViewportRef = useRef<HTMLDivElement | null>(null);
    // Map avoids prototype pollution: Map.set() does not write to object prototype chain.
    const scrollPositionsRef = useRef(new Map<SectionId, number>());

    const [commandOpen, setCommandOpen] = useState(false);
    const [dirtyFlags, setDirtyFlags] = useState<Partial<Record<SectionId, boolean>>>({});

    const handleDirtyChange = useCallback((section: SectionId, dirty: boolean) => {
        setDirtyFlags(prev => {
            if (prev[section] === dirty) return prev;
            return { ...prev, [section]: dirty };
        });
    }, []);

    useLayoutEffect(() => {
        if (contentViewportRef.current) {
            contentViewportRef.current.scrollTop = scrollPositionsRef.current.get(currentSection) ?? 0;
        }
    }, [currentSection]);

    const saveScrollPosition = useCallback(() => {
        if (contentViewportRef.current) {
            scrollPositionsRef.current.set(currentSection, contentViewportRef.current.scrollTop);
        }
    }, [currentSection]);

    const { isAdmin } = useAuth();
    const { isPaid, license } = useLicense();
    const { activeNode } = useNodes();
    const isRemote = activeNode?.type === 'remote';
    const isAdmiral = isPaid && license?.variant === 'admiral';
    const visibility: VisibilityContext = useMemo(
        () => ({ isRemote, isAdmin, isPaid, isAdmiral }),
        [isRemote, isAdmin, isPaid, isAdmiral],
    );

    const activeItem = getSettingsItem(currentSection);
    const activeGroup = activeItem ? getSettingsGroup(activeItem.group) : undefined;
    const nodeName = activeNode?.name ?? 'local';

    const visibleItems = useMemo(
        () => SETTINGS_ITEMS.filter(item => isItemVisible(item, visibility)),
        [visibility],
    );

    const visibleGroups = useMemo(() =>
        SETTINGS_GROUPS
            .map(group => ({
                ...group,
                items: visibleItems.filter(item => item.group === group.id),
            }))
            .filter(group => group.items.length > 0),
        [visibleItems],
    );

    const navigate = useNavigate();

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            setCommandOpen(open => !open);
        }
    }, []);

    const sectionElement = useMemo(() => {
        switch (currentSection) {
            case 'account': return <AccountSection />;
            case 'appearance': return <AppearanceSection />;
            case 'license': return <LicenseSection />;
            case 'users': return <UsersSection />;
            case 'sso': return <SSOSection />;
            case 'api-tokens': return <ApiTokensSection />;
            case 'registries': return <RegistriesSection />;
            case 'labels': return <LabelsSection />;
            case 'system': return <SystemSection onDirtyChange={(d) => handleDirtyChange('system', d)} />;
            case 'notifications': return <NotificationsSection />;
            case 'notification-routing': return <NotificationRoutingSection />;
            case 'webhooks': return <WebhooksSection isPaid={isPaid} />;
            case 'security': return <SecuritySection isPaid={isPaid} />;
            case 'cloud-backup': return <CloudBackupSection />;
            case 'developer': return <DeveloperSection onDirtyChange={(d) => handleDirtyChange('developer', d)} />;
            case 'nodes': return <NodeManager />;
            case 'app-store': return <AppStoreSection />;
            case 'support': return <SupportSection />;
            case 'about': return <AboutSection />;
            default: return <Navigate to="/settings/appearance" replace />;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSection, isPaid]);

    const kicker = activeItem && activeGroup
        ? `Settings · ${activeGroup.label} · ${activeItem.label}`
        : 'Settings';

    const extraStats = useMastheadStatsValue();
    const metadata = useMemo<MastheadMetadataItem[]>(() => {
        const baseScope: MastheadMetadataItem = activeItem
            ? activeItem.scope === 'node'
                ? { label: 'NODE', value: nodeName }
                : { label: 'SCOPE', value: scopeLabel(activeItem) }
            : { label: 'SCOPE', value: 'global' };
        return [baseScope, ...(extraStats ?? [])];
    }, [activeItem, nodeName, extraStats]);

    return (
        <div
            className="flex flex-1 flex-col overflow-hidden min-h-0 gap-3 p-3 bg-background"
            onKeyDown={handleKeyDown}
        >
            <PageMasthead
                kicker={kicker}
                state={activeItem?.label ?? 'Settings'}
                tone="idle"
                metadata={metadata}
                className="rounded-xl border border-card-border border-b-card-border"
            />

            <div className="flex flex-1 min-h-0 gap-3">
                <SettingsSidebar
                    dirtyFlags={dirtyFlags}
                    onOpenPalette={() => setCommandOpen(true)}
                />

                <div className="flex-1 min-h-0 min-w-0 rounded-xl border border-card-border bg-card overflow-hidden flex flex-col">
                    <ScrollArea
                        block
                        viewportRef={contentViewportRef}
                        className="flex-1 min-w-0"
                        onScrollCapture={saveScrollPosition}
                    >
                        <div className="px-7 pt-6 pb-8 flex flex-col gap-6 min-w-0">
                            {activeItem?.description ? (
                                <p className="text-sm text-stat-subtitle/90 leading-relaxed max-w-3xl">
                                    {activeItem.description}
                                </p>
                            ) : null}
                            <SectionGate sectionId={currentSection}>
                                {sectionElement}
                            </SectionGate>
                        </div>
                    </ScrollArea>
                </div>
            </div>

            <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
                <CommandInput placeholder="Jump to a setting..." />
                <CommandList>
                    <CommandEmpty>No matching settings.</CommandEmpty>
                    {visibleGroups.map(group => (
                        <CommandGroup key={group.id} heading={group.label}>
                            {group.items.map(item => (
                                <SettingsCommandItem
                                    key={item.id}
                                    item={item}
                                    glyph={group.glyph}
                                    visibility={visibility}
                                    onSelect={() => {
                                        setCommandOpen(false);
                                        navigate(`/settings/${item.id}`);
                                    }}
                                />
                            ))}
                        </CommandGroup>
                    ))}
                </CommandList>
            </CommandDialog>
        </div>
    );
}

function scopeLabel(item: SettingsItemMeta): string {
    if (item.group === 'identity') return 'operator';
    return 'global';
}

function SettingsCommandItem({
    item,
    glyph,
    visibility,
    onSelect,
}: {
    item: SettingsItemMeta;
    glyph: string;
    visibility: VisibilityContext;
    onSelect: () => void;
}) {
    const locked = isItemLocked(item, visibility);
    const searchValue = [item.label, item.description, ...item.keywords].join(' ').toLowerCase();
    return (
        <CommandItem value={searchValue} onSelect={onSelect}>
            <span className="font-mono text-[11px] w-3 text-center text-stat-subtitle/70">{glyph}</span>
            <div className={cn('flex flex-col gap-0.5 min-w-0 flex-1', locked && 'opacity-60')}>
                <span className="text-sm font-medium text-stat-value truncate">{item.label}</span>
                <span className="text-xs text-stat-subtitle truncate">{item.description}</span>
            </div>
            {item.tier && locked ? <TierLockChip tier={item.tier} /> : null}
        </CommandItem>
    );
}
