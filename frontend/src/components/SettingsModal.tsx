import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { SENCHO_SETTINGS_CHANGED } from '@/lib/events';
import type { SenchoSettingsChangedDetail } from '@/lib/events';
import { Search, X, Lock } from 'lucide-react';
import { NodeManager } from './NodeManager';
import { useNodes } from '@/context/NodeContext';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { SSOSection } from './SSOSection';
import { ApiTokensSection } from './ApiTokensSection';
import { RegistriesSection } from './RegistriesSection';
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
    DeveloperSection,
    AppStoreSection,
    SupportSection,
    AboutSection,
    LabelsSection,
    DEFAULT_SETTINGS,
    SETTINGS_GROUPS,
    SETTINGS_ITEMS,
    getSettingsItem,
    getSettingsGroup,
    isItemVisible,
    isItemLocked,
} from './settings';
import type {
    PatchableSettings,
    SectionId,
    SettingsItemMeta,
    VisibilityContext,
} from './settings';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialSection?: SectionId;
    onLabelsChanged?: () => void;
}

export function SettingsModal({ isOpen, onClose, initialSection, onLabelsChanged }: SettingsModalProps) {
    const { activeNode } = useNodes();
    const { isAdmin } = useAuth();
    const { license, isPaid } = useLicense();
    const isRemote = activeNode?.type === 'remote';
    const isAdmiral = isPaid && license?.variant === 'admiral';
    const [activeSection, setActiveSection] = useState<SectionId>(initialSection || 'account');
    const [commandOpen, setCommandOpen] = useState(false);

    const visibility: VisibilityContext = useMemo(
        () => ({ isRemote, isAdmin, isPaid, isAdmiral }),
        [isRemote, isAdmin, isPaid, isAdmiral],
    );

    const visibleItems = useMemo(
        () => SETTINGS_ITEMS.filter(item => isItemVisible(item, visibility)),
        [visibility],
    );

    const visibleGroups = useMemo(() => {
        return SETTINGS_GROUPS
            .map(group => ({
                ...group,
                items: visibleItems.filter(item => item.group === group.id),
            }))
            .filter(group => group.items.length > 0);
    }, [visibleItems]);

    const contentViewportRef = useRef<HTMLDivElement | null>(null);
    const scrollPositionsRef = useRef<Partial<Record<SectionId, number>>>({});

    const switchSection = useCallback((next: SectionId) => {
        if (contentViewportRef.current) {
            scrollPositionsRef.current[activeSection] = contentViewportRef.current.scrollTop;
        }
        setActiveSection(next);
    }, [activeSection]);

    useLayoutEffect(() => {
        if (contentViewportRef.current) {
            contentViewportRef.current.scrollTop = scrollPositionsRef.current[activeSection] ?? 0;
        }
    }, [activeSection]);

    useEffect(() => {
        if (isOpen && initialSection) setActiveSection(initialSection);
    }, [isOpen, initialSection]);

    useEffect(() => {
        const current = getSettingsItem(activeSection);
        if (!current) return;
        if (!isItemVisible(current, visibility) && visibleItems.length > 0) {
            setActiveSection(visibleItems[0].id);
        }
    }, [visibility, visibleItems, activeSection]);

    const handleDialogKeyDown = useCallback((event: React.KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            event.stopPropagation();
            setCommandOpen(open => !open);
        }
    }, []);

    const [authData, setAuthData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
    const [isSavingPassword, setIsSavingPassword] = useState(false);

    const [settings, setSettings] = useState<PatchableSettings>({ ...DEFAULT_SETTINGS });
    const serverSettingsRef = useRef<PatchableSettings>({ ...DEFAULT_SETTINGS });
    const [isSettingsLoading, setIsSettingsLoading] = useState(false);
    const [isSavingSystem, setIsSavingSystem] = useState(false);
    const [isSavingDeveloper, setIsSavingDeveloper] = useState(false);

    const hasSystemChanges =
        settings.host_cpu_limit !== serverSettingsRef.current.host_cpu_limit ||
        settings.host_ram_limit !== serverSettingsRef.current.host_ram_limit ||
        settings.host_disk_limit !== serverSettingsRef.current.host_disk_limit ||
        settings.docker_janitor_gb !== serverSettingsRef.current.docker_janitor_gb ||
        settings.global_crash !== serverSettingsRef.current.global_crash;

    const hasDeveloperChanges =
        settings.developer_mode !== serverSettingsRef.current.developer_mode ||
        settings.metrics_retention_hours !== serverSettingsRef.current.metrics_retention_hours ||
        settings.log_retention_days !== serverSettingsRef.current.log_retention_days ||
        settings.audit_retention_days !== serverSettingsRef.current.audit_retention_days;

    const sectionDirtyFlags: Partial<Record<SectionId, boolean>> = {
        system: hasSystemChanges,
        developer: hasDeveloperChanges,
    };

    useEffect(() => {
        if (isOpen) fetchSettings();
    }, [isOpen, activeNode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchSettings = async () => {
        setIsSettingsLoading(true);
        try {
            const nodeRes = await apiFetch('/settings');
            const localRes = isRemote ? await apiFetch('/settings', { localOnly: true }) : nodeRes;
            const nodeData: Record<string, string> = nodeRes.ok ? await nodeRes.json() : {};
            const localData: Record<string, string> = (isRemote && localRes.ok)
                ? await localRes.json()
                : nodeData;

            const safe: PatchableSettings = {
                host_cpu_limit: nodeData.host_cpu_limit ?? DEFAULT_SETTINGS.host_cpu_limit,
                host_ram_limit: nodeData.host_ram_limit ?? DEFAULT_SETTINGS.host_ram_limit,
                host_disk_limit: nodeData.host_disk_limit ?? DEFAULT_SETTINGS.host_disk_limit,
                docker_janitor_gb: nodeData.docker_janitor_gb ?? DEFAULT_SETTINGS.docker_janitor_gb,
                global_crash: (nodeData.global_crash as '0' | '1') ?? DEFAULT_SETTINGS.global_crash,
                template_registry_url: nodeData.template_registry_url ?? '',
                developer_mode: (localData.developer_mode as '0' | '1') ?? DEFAULT_SETTINGS.developer_mode,
                metrics_retention_hours: localData.metrics_retention_hours ?? DEFAULT_SETTINGS.metrics_retention_hours,
                log_retention_days: localData.log_retention_days ?? DEFAULT_SETTINGS.log_retention_days,
                audit_retention_days: localData.audit_retention_days ?? DEFAULT_SETTINGS.audit_retention_days,
            };
            setSettings(safe);
            serverSettingsRef.current = { ...safe };
        } catch (e) {
            console.error('Failed to fetch settings', e);
        } finally {
            setIsSettingsLoading(false);
        }
    };

    const handleSettingChange = <K extends keyof PatchableSettings>(key: K, value: PatchableSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const patchSettings = async (payload: PatchableSettings, setLoading: (v: boolean) => void, localOnly = false): Promise<boolean> => {
        setLoading(true);
        try {
            const res = await apiFetch('/settings', {
                method: 'PATCH',
                body: JSON.stringify(payload),
                localOnly,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to save settings.');
                return false;
            }
            serverSettingsRef.current = { ...serverSettingsRef.current, ...payload };
            return true;
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Something went wrong.');
            return false;
        } finally {
            setLoading(false);
        }
    };

    const saveSystemSettings = async () => {
        const ok = await patchSettings({
            host_cpu_limit: settings.host_cpu_limit,
            host_ram_limit: settings.host_ram_limit,
            host_disk_limit: settings.host_disk_limit,
            docker_janitor_gb: settings.docker_janitor_gb,
            global_crash: settings.global_crash,
        }, setIsSavingSystem);
        if (ok) toast.success('System limits saved.');
    };

    const saveDeveloperSettings = async () => {
        const payload = {
            developer_mode: settings.developer_mode,
            metrics_retention_hours: settings.metrics_retention_hours,
            log_retention_days: settings.log_retention_days,
            audit_retention_days: settings.audit_retention_days,
        };
        const ok = await patchSettings(payload, setIsSavingDeveloper, true);
        if (ok) {
            toast.success('Developer settings saved.');
            window.dispatchEvent(new CustomEvent<SenchoSettingsChangedDetail>(SENCHO_SETTINGS_CHANGED, {
                detail: { changedKeys: Object.keys(payload) },
            }));
        }
    };

    const handlePasswordChange = async () => {
        if (!authData.oldPassword || !authData.newPassword || !authData.confirmPassword) {
            toast.error('All fields are required');
            return;
        }
        if (authData.newPassword !== authData.confirmPassword) {
            toast.error('New passwords do not match');
            return;
        }
        if (authData.newPassword.length < 8) {
            toast.error('New password must be at least 8 characters');
            return;
        }
        setIsSavingPassword(true);
        try {
            const res = await apiFetch('/auth/password', {
                method: 'PUT',
                body: JSON.stringify({ oldPassword: authData.oldPassword, newPassword: authData.newPassword }),
            });
            if (res.ok) {
                toast.success('Password updated successfully');
                setAuthData({ oldPassword: '', newPassword: '', confirmPassword: '' });
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data?.error || 'Failed to update password');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Network error during password change');
        } finally {
            setIsSavingPassword(false);
        }
    };

    const handleRegistrySaved = (key: keyof PatchableSettings, value: string) => {
        serverSettingsRef.current = { ...serverSettingsRef.current, [key]: value };
    };

    const activeItem = getSettingsItem(activeSection);
    const activeGroup = activeItem ? getSettingsGroup(activeItem.group) : undefined;

    const renderSection = () => {
        switch (activeSection) {
            case 'account':
                return (
                    <AccountSection
                        authData={authData}
                        onAuthDataChange={setAuthData}
                        onPasswordChange={handlePasswordChange}
                        isSaving={isSavingPassword}
                    />
                );
            case 'appearance': return <AppearanceSection />;
            case 'license': return <LicenseSection />;
            case 'users': return <UsersSection />;
            case 'sso': return <SSOSection />;
            case 'api-tokens': return <ApiTokensSection />;
            case 'registries': return <RegistriesSection />;
            case 'labels': return <LabelsSection onLabelsChanged={onLabelsChanged} />;
            case 'system':
                return (
                    <SystemSection
                        settings={settings}
                        onSettingChange={handleSettingChange}
                        onSave={saveSystemSettings}
                        isSaving={isSavingSystem}
                        isLoading={isSettingsLoading}
                    />
                );
            case 'notifications': return <NotificationsSection />;
            case 'notification-routing': return <NotificationRoutingSection />;
            case 'webhooks': return <WebhooksSection isPaid={isPaid} />;
            case 'security': return <SecuritySection isPaid={isPaid} />;
            case 'developer':
                return (
                    <DeveloperSection
                        settings={settings}
                        onSettingChange={handleSettingChange}
                        onSave={saveDeveloperSettings}
                        isSaving={isSavingDeveloper}
                        isLoading={isSettingsLoading}
                        isRemote={isRemote}
                    />
                );
            case 'nodes': return <NodeManager />;
            case 'appstore':
                return (
                    <AppStoreSection
                        settings={settings}
                        onSettingChange={handleSettingChange}
                        isLoading={isSettingsLoading}
                        onSaved={handleRegistrySaved}
                    />
                );
            case 'support': return <SupportSection />;
            case 'about': return <AboutSection />;
            default: return null;
        }
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DialogContent
                    showClose={false}
                    onKeyDownCapture={handleDialogKeyDown}
                    className="sm:max-w-[960px] h-[min(780px,90vh)] flex p-0 font-sans shadow-lg bg-background border-border overflow-hidden gap-0"
                >
                    <VisuallyHidden><DialogTitle>Settings Hub</DialogTitle></VisuallyHidden>
                    <VisuallyHidden><DialogDescription>Configure Sencho settings</DialogDescription></VisuallyHidden>

                    <aside className="w-[220px] bg-glass border-r border-glass-border flex flex-col shrink-0 min-h-0">
                        <div className="px-4 pt-4 pb-3">
                            <div className="font-display italic text-xl leading-none text-stat-value">Settings</div>
                            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-stat-subtitle">
                                {isRemote && activeNode ? `node · ${activeNode.name}` : 'control plane'}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setCommandOpen(true)}
                            className="mx-3 mb-3 flex items-center gap-2 rounded-md border border-card-border border-t-card-border-top bg-card px-2.5 py-1.5 shadow-card-bevel transition-colors hover:border-t-card-border-hover"
                        >
                            <Search className="h-3 w-3 text-stat-subtitle" strokeWidth={1.5} />
                            <span className="flex-1 text-left font-mono text-[11px] text-stat-subtitle">Filter settings</span>
                            <kbd className="font-mono text-[10px] text-stat-subtitle/70 tabular-nums">{`\u2318K`}</kbd>
                        </button>

                        <ScrollArea className="flex-1 px-3">
                            <nav className="flex flex-col gap-4 pb-4">
                                {visibleGroups.map(group => (
                                    <div key={group.id} className="flex flex-col gap-0.5">
                                        <div className="flex items-baseline gap-1.5 px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.22em] text-stat-subtitle">
                                            <span>{group.label}</span>
                                            {group.kicker ? (
                                                <span className="text-stat-subtitle/60">· {group.kicker}</span>
                                            ) : null}
                                        </div>
                                        {group.items.map(item => {
                                            const locked = isItemLocked(item, visibility);
                                            const isActive = activeSection === item.id;
                                            const showDot = sectionDirtyFlags[item.id];
                                            return (
                                                <button
                                                    type="button"
                                                    key={item.id}
                                                    onClick={() => switchSection(item.id)}
                                                    className={cn(
                                                        'relative flex items-center gap-2 rounded-sm px-2 py-[var(--density-cell-y)] text-left transition-colors',
                                                        isActive
                                                            ? 'bg-gradient-to-r from-brand/10 to-transparent text-stat-value'
                                                            : 'text-stat-subtitle hover:bg-accent/40 hover:text-stat-value',
                                                    )}
                                                >
                                                    {isActive ? (
                                                        <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-brand" />
                                                    ) : null}
                                                    <span
                                                        aria-hidden="true"
                                                        className={cn(
                                                            'font-mono text-[11px] leading-none w-3 text-center',
                                                            isActive ? 'text-brand' : 'text-stat-subtitle/70',
                                                        )}
                                                    >
                                                        {group.glyph}
                                                    </span>
                                                    <span className="flex-1 truncate text-sm font-medium">{item.label}</span>
                                                    {item.tier ? (
                                                        <TierChip tier={item.tier} locked={locked} />
                                                    ) : null}
                                                    {showDot ? (
                                                        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                                                    ) : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ))}
                            </nav>
                        </ScrollArea>
                    </aside>

                    <div className="flex-1 flex flex-col min-h-0 min-w-0">
                        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border/60">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
                                    <span>Settings</span>
                                    <span className="text-stat-subtitle/50">{`\u203A`}</span>
                                    <span>{activeGroup?.label ?? ''}</span>
                                    <span className="text-stat-subtitle/50">{`\u203A`}</span>
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
                                    <div className="mt-1 text-sm text-stat-subtitle/90 truncate">
                                        {activeItem.description}
                                    </div>
                                ) : null}
                            </div>
                            <DialogClose className="mt-1 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
                                <X className="h-4 w-4" strokeWidth={1.5} />
                                <span className="sr-only">Close</span>
                            </DialogClose>
                        </header>
                        <ScrollArea block viewportRef={contentViewportRef} className="flex-1 min-w-0">
                            <div className="px-6 py-5 flex flex-col gap-6 min-w-0">
                                {renderSection()}
                            </div>
                        </ScrollArea>
                    </div>
                </DialogContent>
            </Dialog>

            <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
                <CommandInput placeholder="Jump to a setting..." />
                <CommandList>
                    <CommandEmpty>No matching settings.</CommandEmpty>
                    {visibleGroups.map(group => (
                        <CommandGroup key={group.id} heading={group.label}>
                            {group.items.map(item => (
                                <CommandSearchItem
                                    key={item.id}
                                    item={item}
                                    glyph={group.glyph}
                                    visibility={visibility}
                                    onSelect={() => {
                                        setCommandOpen(false);
                                        switchSection(item.id);
                                    }}
                                />
                            ))}
                        </CommandGroup>
                    ))}
                </CommandList>
            </CommandDialog>
        </>
    );
}

function CommandSearchItem({
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
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="text-sm font-medium text-stat-value truncate">{item.label}</span>
                <span className="text-xs text-stat-subtitle truncate">{item.description}</span>
            </div>
            {item.tier ? <TierChip tier={item.tier} locked={locked} /> : null}
        </CommandItem>
    );
}

function TierChip({ tier, locked }: { tier: NonNullable<SettingsItemMeta['tier']>; locked: boolean }) {
    const label = tier === 'admiral' ? 'ADMIRAL' : 'SKIPPER';
    if (locked) {
        return (
            <span className="flex items-center gap-1 rounded-sm border border-card-border bg-card px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-stat-subtitle/80">
                <Lock className="h-2.5 w-2.5" strokeWidth={1.5} />
                {label}
            </span>
        );
    }
    return (
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-brand/70">
            {label}
        </span>
    );
}
