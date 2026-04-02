import { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import {
    Shield, Activity, Bell, Code, Server, Package,
    Info, Crown, Webhook, Users, Zap, Database, LifeBuoy, Lock,
} from 'lucide-react';
import { NodeManager } from './NodeManager';
import { useNodes } from '@/context/NodeContext';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { SSOSection } from './SSOSection';
import { ApiTokensSection } from './ApiTokensSection';
import { RegistriesSection } from './RegistriesSection';
import {
    AccountSection,
    LicenseSection,
    UsersSection,
    SystemSection,
    NotificationsSection,
    WebhooksSection,
    DeveloperSection,
    AppStoreSection,
    SupportSection,
    AboutSection,
    DEFAULT_SETTINGS,
} from './settings';
import type { PatchableSettings, SectionId } from './settings';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { activeNode } = useNodes();
    const { isAdmin } = useAuth();
    const { license, isPro } = useLicense();
    const isRemote = activeNode?.type === 'remote';
    const [activeSection, setActiveSection] = useState<SectionId>('account');

    // When switching to a remote node, reset to a node-scoped section if on a global-only one
    useEffect(() => {
        if (isRemote && (activeSection === 'account' || activeSection === 'license' || activeSection === 'users' || activeSection === 'sso' || activeSection === 'api-tokens' || activeSection === 'registries' || activeSection === 'notifications' || activeSection === 'webhooks' || activeSection === 'nodes' || activeSection === 'appstore')) {
            setActiveSection('system');
        }
    }, [isRemote]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auth State
    const [authData, setAuthData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
    const [isSavingPassword, setIsSavingPassword] = useState(false);

    // Settings state
    const [settings, setSettings] = useState<PatchableSettings>({ ...DEFAULT_SETTINGS });
    const serverSettingsRef = useRef<PatchableSettings>({ ...DEFAULT_SETTINGS });
    const [isSettingsLoading, setIsSettingsLoading] = useState(false);
    const [isSavingSystem, setIsSavingSystem] = useState(false);
    const [isSavingDeveloper, setIsSavingDeveloper] = useState(false);

    // Unsaved changes indicators
    const hasSystemChanges =
        settings.host_cpu_limit !== serverSettingsRef.current.host_cpu_limit ||
        settings.host_ram_limit !== serverSettingsRef.current.host_ram_limit ||
        settings.host_disk_limit !== serverSettingsRef.current.host_disk_limit ||
        settings.docker_janitor_gb !== serverSettingsRef.current.docker_janitor_gb ||
        settings.global_crash !== serverSettingsRef.current.global_crash;

    const hasDeveloperChanges =
        settings.developer_mode !== serverSettingsRef.current.developer_mode ||
        settings.global_logs_refresh !== serverSettingsRef.current.global_logs_refresh ||
        settings.metrics_retention_hours !== serverSettingsRef.current.metrics_retention_hours ||
        settings.log_retention_days !== serverSettingsRef.current.log_retention_days ||
        settings.audit_retention_days !== serverSettingsRef.current.audit_retention_days;

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
                global_logs_refresh: (localData.global_logs_refresh as '1' | '3' | '5' | '10') ?? DEFAULT_SETTINGS.global_logs_refresh,
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
        const ok = await patchSettings({
            developer_mode: settings.developer_mode,
            global_logs_refresh: settings.global_logs_refresh,
            metrics_retention_hours: settings.metrics_retention_hours,
            log_retention_days: settings.log_retention_days,
            audit_retention_days: settings.audit_retention_days,
        }, setIsSavingDeveloper, true);
        if (ok) toast.success('Developer settings saved.');
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

    // --- Nav items ---
    const NavButton = ({ section, icon, label, showDot, locked }: {
        section: SectionId;
        icon: React.ReactNode;
        label: string;
        showDot?: boolean;
        locked?: boolean;
    }) => (
        <Button
            variant={activeSection === section ? 'secondary' : 'ghost'}
            className="w-full justify-start font-medium relative"
            onClick={() => setActiveSection(section)}
        >
            {icon}
            {label}
            {locked && <Lock className="w-3 h-3 ml-auto text-muted-foreground/50" />}
            {showDot && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
        </Button>
    );

    // --- Section rendering ---
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
            case 'license':
                return <LicenseSection />;
            case 'users':
                return <UsersSection />;
            case 'sso':
                return <SSOSection />;
            case 'api-tokens':
                return <ApiTokensSection />;
            case 'registries':
                return <RegistriesSection />;
            case 'system':
                return (
                    <SystemSection
                        settings={settings}
                        onSettingChange={handleSettingChange}
                        onSave={saveSystemSettings}
                        isSaving={isSavingSystem}
                        isLoading={isSettingsLoading}
                        isRemote={isRemote}
                        activeNodeName={activeNode?.name}
                    />
                );
            case 'notifications':
                return <NotificationsSection />;
            case 'webhooks':
                return <WebhooksSection isPro={isPro} />;
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
            case 'nodes':
                return <NodeManager />;
            case 'appstore':
                return (
                    <AppStoreSection
                        settings={settings}
                        onSettingChange={handleSettingChange}
                        isLoading={isSettingsLoading}
                        onSaved={handleRegistrySaved}
                    />
                );
            case 'support':
                return <SupportSection />;
            case 'about':
                return <AboutSection />;
        }
    };

    const isTeamPro = isPro && license?.variant === 'team';

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[900px] h-[min(650px,85vh)] flex p-0 font-sans shadow-lg bg-background border-border overflow-hidden gap-0">
                <VisuallyHidden><DialogTitle>Settings Hub</DialogTitle></VisuallyHidden>
                <VisuallyHidden><DialogDescription>Configure Sencho settings</DialogDescription></VisuallyHidden>

                {/* Sidebar */}
                <div className="w-[200px] bg-glass border-r border-glass-border flex flex-col p-4 shrink-0 min-h-0">
                    <div className="font-medium text-lg mb-1 text-foreground tracking-tight">Settings Hub</div>
                    {isRemote ? (
                        <div className="text-xs text-muted-foreground mb-5 truncate">{activeNode!.name}</div>
                    ) : (
                        <div className="mb-5" />
                    )}
                    <nav className="space-y-1.5 flex flex-col flex-1 overflow-y-auto">
                        {/* Account / License */}
                        {!isRemote && (
                            <NavButton section="account" icon={<Shield className="w-4 h-4 mr-2" />} label="Account" />
                        )}
                        {!isRemote && (
                            <NavButton section="license" icon={<Crown className="w-4 h-4 mr-2" />} label="License" />
                        )}

                        {!isRemote && <Separator className="my-1.5" />}

                        {/* Users / SSO / API Tokens / Registries */}
                        {!isRemote && isAdmin && (
                            <NavButton section="users" icon={<Users className="w-4 h-4 mr-2" />} label="Users" locked={!isPro} />
                        )}
                        {!isRemote && isAdmin && (
                            <NavButton section="sso" icon={<Shield className="w-4 h-4 mr-2" />} label="SSO" locked={!isTeamPro} />
                        )}
                        {!isRemote && isAdmin && (
                            <NavButton section="api-tokens" icon={<Zap className="w-4 h-4 mr-2" />} label="API Tokens" locked={!isTeamPro} />
                        )}
                        {!isRemote && isAdmin && (
                            <NavButton section="registries" icon={<Database className="w-4 h-4 mr-2" />} label="Registries" locked={!isTeamPro} />
                        )}

                        {!isRemote && isAdmin && <Separator className="my-1.5" />}

                        {/* System / Notifications / Webhooks / Developer */}
                        <NavButton
                            section="system"
                            icon={<Activity className="w-4 h-4 mr-2" />}
                            label="System Limits"
                            showDot={hasSystemChanges}
                        />
                        <NavButton section="notifications" icon={<Bell className="w-4 h-4 mr-2" />} label="Notifications" />
                        {!isRemote && (
                            <NavButton section="webhooks" icon={<Webhook className="w-4 h-4 mr-2" />} label="Webhooks" locked={!isPro} />
                        )}
                        <NavButton
                            section="developer"
                            icon={<Code className="w-4 h-4 mr-2" />}
                            label="Developer"
                            showDot={hasDeveloperChanges}
                        />

                        <Separator className="my-1.5" />

                        {/* Nodes / App Store */}
                        {!isRemote && (
                            <NavButton section="nodes" icon={<Server className="w-4 h-4 mr-2" />} label="Nodes" />
                        )}
                        {!isRemote && (
                            <NavButton section="appstore" icon={<Package className="w-4 h-4 mr-2" />} label="App Store" />
                        )}

                        <Separator className="my-1.5" />

                        {/* Support / About */}
                        <NavButton section="support" icon={<LifeBuoy className="w-4 h-4 mr-2" />} label="Support" />
                        <NavButton section="about" icon={<Info className="w-4 h-4 mr-2" />} label="About" />
                    </nav>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
                    {renderSection()}
                </div>
            </DialogContent>
        </Dialog>
    );
}
