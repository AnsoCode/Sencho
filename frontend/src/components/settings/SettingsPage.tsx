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
import { Lock } from 'lucide-react';
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
import { cn } from '@/lib/utils';

export function SettingsPage() {
    const { sectionId } = useParams<{ sectionId: string }>();
    // Validate against the known registry before using as a property key to prevent
    // prototype pollution (CodeQL js/remote-property-injection).
    const currentSection: SectionId = SETTINGS_ITEMS.some(i => i.id === sectionId)
        ? (sectionId as SectionId)
        : 'appearance';

    const contentViewportRef = useRef<HTMLDivElement | null>(null);
    const scrollPositionsRef = useRef<Partial<Record<SectionId, number>>>({});

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
            contentViewportRef.current.scrollTop = scrollPositionsRef.current[currentSection] ?? 0;
        }
    }, [currentSection]);

    const saveScrollPosition = useCallback(() => {
        if (contentViewportRef.current) {
            scrollPositionsRef.current[currentSection] = contentViewportRef.current.scrollTop;
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

    return (
        <div
            className="flex flex-1 overflow-hidden min-h-0"
            onKeyDown={handleKeyDown}
        >
            <SettingsSidebar
                dirtyFlags={dirtyFlags}
                onOpenPalette={() => setCommandOpen(true)}
            />

            <div className="flex-1 flex flex-col min-h-0 min-w-0">
                <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border/60 shrink-0">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
                            <span>Settings</span>
                            <span className="text-stat-subtitle/50">›</span>
                            <span>{activeGroup?.label ?? ''}</span>
                            <span className="text-stat-subtitle/50">›</span>
                            <span className="text-stat-value">{activeItem?.label ?? ''}</span>
                            {activeItem?.scope === 'node' ? (
                                <span className="ml-2 flex items-center gap-1 text-brand">
                                    <span className="text-stat-subtitle/50">·</span>
                                    <span className="truncate max-w-[160px]">{activeNode?.name ?? 'local'}</span>
                                    <span className="text-stat-subtitle/70">(node-scoped)</span>
                                </span>
                            ) : null}
                        </div>
                        <h2 className="mt-1.5 font-display italic text-2xl leading-tight text-stat-value truncate">
                            {activeItem?.label ?? 'Settings'}
                        </h2>
                        {activeItem?.description ? (
                            <p className="mt-1 text-sm text-stat-subtitle/90 truncate">
                                {activeItem.description}
                            </p>
                        ) : null}
                    </div>
                </header>

                <ScrollArea
                    block
                    viewportRef={contentViewportRef}
                    className="flex-1 min-w-0"
                    onScrollCapture={saveScrollPosition}
                >
                    <div className="px-6 py-5 flex flex-col gap-6 min-w-0">
                        <SectionGate sectionId={currentSection}>
                            {sectionElement}
                        </SectionGate>
                    </div>
                </ScrollArea>
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
            {item.tier && locked ? (
                <span className="flex items-center gap-1 rounded-sm border border-card-border bg-card px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-stat-subtitle/80">
                    <Lock className="h-2.5 w-2.5" strokeWidth={1.5} />
                    {item.tier === 'admiral' ? 'ADMIRAL' : 'SKIPPER'}
                </span>
            ) : null}
        </CommandItem>
    );
}
