import { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogContent,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Activity, Bell, Palette, Moon, Sun, Code, Server, Package, RefreshCw, Database, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { NodeManager } from './NodeManager';
import { useNodes } from '@/context/NodeContext';

interface Agent {
    type: 'discord' | 'slack' | 'webhook';
    url: string;
    enabled: boolean;
}

// Keys that the settings PATCH endpoint accepts
interface PatchableSettings {
    host_cpu_limit?: string;
    host_ram_limit?: string;
    host_disk_limit?: string;
    docker_janitor_gb?: string;
    global_crash?: '0' | '1';
    global_logs_refresh?: '1' | '3' | '5' | '10';
    developer_mode?: '0' | '1';
    template_registry_url?: string;
    metrics_retention_hours?: string;
    log_retention_days?: string;
}

type SectionId = 'account' | 'system' | 'notifications' | 'appearance' | 'developer' | 'nodes' | 'appstore';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    isDarkMode: boolean;
    setIsDarkMode: (mode: boolean) => void;
}

const DEFAULT_SETTINGS: PatchableSettings = {
    host_cpu_limit: '90',
    host_ram_limit: '90',
    host_disk_limit: '90',
    global_crash: '1',
    docker_janitor_gb: '5',
    global_logs_refresh: '5',
    developer_mode: '0',
    template_registry_url: '',
    metrics_retention_hours: '24',
    log_retention_days: '30',
};

export function SettingsModal({ isOpen, onClose, isDarkMode, setIsDarkMode }: SettingsModalProps) {
    const { activeNode } = useNodes();
    const isRemote = activeNode?.type === 'remote';
    const [activeSection, setActiveSection] = useState<SectionId>('account');

    // When switching to a remote node, reset to a node-scoped section if on a global-only one
    useEffect(() => {
        if (isRemote && (activeSection === 'account' || activeSection === 'notifications' || activeSection === 'appearance' || activeSection === 'nodes' || activeSection === 'appstore')) {
            setActiveSection('system');
        }
    }, [isRemote]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auth State
    const [authData, setAuthData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });

    // Notification agents state
    const [agents, setAgents] = useState<Record<string, Agent>>({
        discord: { type: 'discord', url: '', enabled: false },
        slack: { type: 'slack', url: '', enabled: false },
        webhook: { type: 'webhook', url: '', enabled: false },
    });

    // Settings state — all user-configurable keys (no auth keys)
    const [settings, setSettings] = useState<PatchableSettings>({ ...DEFAULT_SETTINGS });

    // Track server state to detect unsaved changes without causing re-renders
    const serverSettingsRef = useRef<PatchableSettings>({ ...DEFAULT_SETTINGS });

    // Per-operation loading states
    const [isSettingsLoading, setIsSettingsLoading] = useState(false);
    const [isSavingSystem, setIsSavingSystem] = useState(false);
    const [isSavingDeveloper, setIsSavingDeveloper] = useState(false);
    const [isSavingPassword, setIsSavingPassword] = useState(false);
    const [isSavingRegistry, setIsSavingRegistry] = useState(false);
    const [isSavingAgent, setIsSavingAgent] = useState<Record<string, boolean>>({});
    const [isTestingAgent, setIsTestingAgent] = useState<Record<string, boolean>>({});

    // Unsaved changes indicators per section (compared against server ref)
    const hasSystemChanges =
        settings.host_cpu_limit   !== serverSettingsRef.current.host_cpu_limit   ||
        settings.host_ram_limit   !== serverSettingsRef.current.host_ram_limit   ||
        settings.host_disk_limit  !== serverSettingsRef.current.host_disk_limit  ||
        settings.docker_janitor_gb !== serverSettingsRef.current.docker_janitor_gb ||
        settings.global_crash     !== serverSettingsRef.current.global_crash;

    const hasDeveloperChanges =
        settings.developer_mode          !== serverSettingsRef.current.developer_mode          ||
        settings.global_logs_refresh     !== serverSettingsRef.current.global_logs_refresh     ||
        settings.metrics_retention_hours !== serverSettingsRef.current.metrics_retention_hours ||
        settings.log_retention_days      !== serverSettingsRef.current.log_retention_days;

    useEffect(() => {
        if (isOpen) {
            fetchAgents();
            fetchSettings();
        }
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchAgents = async () => {
        try {
            const res = await apiFetch('/agents');
            if (res.ok) {
                const data: Agent[] = await res.json();
                setAgents(prev => {
                    const next = { ...prev };
                    data.forEach(a => { next[a.type] = a; });
                    return next;
                });
            }
        } catch (e) {
            console.error('Failed to fetch agents', e);
        }
    };

    const fetchSettings = async () => {
        setIsSettingsLoading(true);
        try {
            // Fetch per-node settings from the active node (system limits etc.)
            const nodeRes = await apiFetch('/settings');
            // Always fetch developer/UI preferences from local — these control
            // this Sencho instance's behaviour and must never be proxied to remote
            const localRes = isRemote ? await apiFetch('/settings', { localOnly: true }) : nodeRes;

            const nodeData: Record<string, string> = nodeRes.ok ? await nodeRes.json() : {};
            const localData: Record<string, string> = (isRemote && localRes.ok)
                ? await localRes.json()
                : nodeData;

            const safe: PatchableSettings = {
                // Per-node: read from active node
                host_cpu_limit:          nodeData.host_cpu_limit          ?? DEFAULT_SETTINGS.host_cpu_limit,
                host_ram_limit:          nodeData.host_ram_limit          ?? DEFAULT_SETTINGS.host_ram_limit,
                host_disk_limit:         nodeData.host_disk_limit         ?? DEFAULT_SETTINGS.host_disk_limit,
                docker_janitor_gb:       nodeData.docker_janitor_gb       ?? DEFAULT_SETTINGS.docker_janitor_gb,
                global_crash:            (nodeData.global_crash as '0' | '1') ?? DEFAULT_SETTINGS.global_crash,
                template_registry_url:   nodeData.template_registry_url   ?? '',
                // Local-only: always read from local node
                global_logs_refresh:     (localData.global_logs_refresh as '1' | '3' | '5' | '10') ?? DEFAULT_SETTINGS.global_logs_refresh,
                developer_mode:          (localData.developer_mode as '0' | '1')                   ?? DEFAULT_SETTINGS.developer_mode,
                metrics_retention_hours: localData.metrics_retention_hours ?? DEFAULT_SETTINGS.metrics_retention_hours,
                log_retention_days:      localData.log_retention_days      ?? DEFAULT_SETTINGS.log_retention_days,
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
            host_cpu_limit:    settings.host_cpu_limit,
            host_ram_limit:    settings.host_ram_limit,
            host_disk_limit:   settings.host_disk_limit,
            docker_janitor_gb: settings.docker_janitor_gb,
            global_crash:      settings.global_crash,
        }, setIsSavingSystem);
        if (ok) toast.success('System limits saved.');
    };

    const saveDeveloperSettings = async () => {
        // Developer/UI preferences are local-only — never proxy to remote node
        const ok = await patchSettings({
            developer_mode:          settings.developer_mode,
            global_logs_refresh:     settings.global_logs_refresh,
            metrics_retention_hours: settings.metrics_retention_hours,
            log_retention_days:      settings.log_retention_days,
        }, setIsSavingDeveloper, true);
        if (ok) toast.success('Developer settings saved.');
    };

    const saveRegistrySettings = async () => {
        setIsSavingRegistry(true);
        try {
            const res = await apiFetch('/settings', {
                method: 'PATCH',
                body: JSON.stringify({ template_registry_url: settings.template_registry_url ?? '' }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to save registry settings.');
                return;
            }
            serverSettingsRef.current = { ...serverSettingsRef.current, template_registry_url: settings.template_registry_url };
            await apiFetch('/templates/refresh-cache', { method: 'POST' });
            toast.success('Registry saved. App Store will reload from the new source.');
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Failed to save registry settings.');
        } finally {
            setIsSavingRegistry(false);
        }
    };

    const handleAgentChange = (type: string, field: keyof Agent, value: Agent[keyof Agent]) => {
        setAgents(prev => ({
            ...prev,
            [type]: { ...prev[type], [field]: value }
        }));
    };

    const saveAgent = async (type: string) => {
        setIsSavingAgent(prev => ({ ...prev, [type]: true }));
        try {
            const res = await apiFetch('/agents', {
                method: 'POST',
                body: JSON.stringify(agents[type])
            });
            if (res.ok) {
                toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} settings saved.`);
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Something went wrong.');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Network error.');
        } finally {
            setIsSavingAgent(prev => ({ ...prev, [type]: false }));
        }
    };

    const testAgent = async (type: string) => {
        if (!agents[type].url) {
            toast.error('Please enter a webhook URL first.');
            return;
        }
        setIsTestingAgent(prev => ({ ...prev, [type]: true }));
        try {
            const res = await apiFetch('/notifications/test', {
                method: 'POST',
                body: JSON.stringify({ type, url: agents[type].url })
            });
            if (res.ok) {
                toast.success('Test notification sent!');
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.details || err?.error || 'Test failed.');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Network error.');
        } finally {
            setIsTestingAgent(prev => ({ ...prev, [type]: false }));
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
        if (authData.newPassword.length < 6) {
            toast.error('New password must be at least 6 characters');
            return;
        }
        setIsSavingPassword(true);
        try {
            const res = await apiFetch('/auth/password', {
                method: 'PUT',
                body: JSON.stringify({ oldPassword: authData.oldPassword, newPassword: authData.newPassword })
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

    const renderAgentTab = (type: 'discord' | 'slack' | 'webhook', title: string) => (
        <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
                <Label htmlFor={`${type}-enabled`} className="font-semibold">Enable {title}</Label>
                <Switch
                    id={`${type}-enabled`}
                    checked={agents[type].enabled}
                    onCheckedChange={(c) => handleAgentChange(type, 'enabled', c)}
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor={`${type}-url`}>Webhook URL</Label>
                <Input
                    id={`${type}-url`}
                    placeholder="https://..."
                    value={agents[type].url}
                    onChange={(e) => handleAgentChange(type, 'url', e.target.value)}
                />
            </div>
            <div className="flex space-x-2 justify-end pt-4">
                <Button variant="outline" onClick={() => testAgent(type)} disabled={isTestingAgent[type]}>
                    {isTestingAgent[type] ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Testing...</> : 'Test'}
                </Button>
                <Button onClick={() => saveAgent(type)} disabled={isSavingAgent[type]}>
                    {isSavingAgent[type] ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save'}
                </Button>
            </div>
        </div>
    );

    const SettingsSkeleton = () => (
        <div className="space-y-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="space-y-4 bg-muted/10 p-4 border border-border rounded-xl">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        </div>
    );

    const NavButton = ({ section, icon, label, showDot }: { section: SectionId; icon: React.ReactNode; label: string; showDot?: boolean }) => (
        <Button
            variant={activeSection === section ? 'secondary' : 'ghost'}
            className="w-full justify-start font-medium relative"
            onClick={() => setActiveSection(section)}
        >
            {icon}
            {label}
            {showDot && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
        </Button>
    );

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[900px] h-[650px] flex p-0 font-sans shadow-lg bg-background border-border overflow-hidden gap-0">
                {/* Sidebar */}
                <div className="w-[200px] bg-muted/20 border-r border-border flex flex-col p-4 shrink-0">
                    <div className="font-semibold text-lg mb-1 text-foreground tracking-tight">Settings Hub</div>
                    {isRemote ? (
                        <div className="text-xs text-muted-foreground mb-5 truncate">{activeNode!.name}</div>
                    ) : (
                        <div className="mb-5" />
                    )}
                    <nav className="space-y-1.5 flex flex-col">
                        {!isRemote && (
                            <NavButton section="account" icon={<Shield className="w-4 h-4 mr-2" />} label="Account" />
                        )}
                        <NavButton
                            section="system"
                            icon={<Activity className="w-4 h-4 mr-2" />}
                            label="System Limits"
                            showDot={hasSystemChanges}
                        />
                        {!isRemote && (
                            <NavButton section="notifications" icon={<Bell className="w-4 h-4 mr-2" />} label="Notifications" />
                        )}
                        {!isRemote && (
                            <NavButton section="appearance" icon={<Palette className="w-4 h-4 mr-2" />} label="Appearance" />
                        )}
                        <NavButton
                            section="developer"
                            icon={<Code className="w-4 h-4 mr-2" />}
                            label="Developer"
                            showDot={hasDeveloperChanges}
                        />
                        {!isRemote && (
                            <NavButton section="nodes" icon={<Server className="w-4 h-4 mr-2" />} label="Nodes" />
                        )}
                        {!isRemote && (
                            <NavButton section="appstore" icon={<Package className="w-4 h-4 mr-2" />} label="App Store" />
                        )}
                    </nav>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">

                    {activeSection === 'account' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight">Account & Security</h3>
                                <p className="text-sm text-muted-foreground">Manage your credentials and authentication.</p>
                            </div>
                            <div className="space-y-4 max-w-sm">
                                <div className="space-y-2">
                                    <Label>Current Password</Label>
                                    <Input
                                        type="password"
                                        value={authData.oldPassword}
                                        onChange={(e) => setAuthData(prev => ({ ...prev, oldPassword: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>New Password</Label>
                                    <Input
                                        type="password"
                                        value={authData.newPassword}
                                        onChange={(e) => setAuthData(prev => ({ ...prev, newPassword: e.target.value }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Confirm New Password</Label>
                                    <Input
                                        type="password"
                                        value={authData.confirmPassword}
                                        onChange={(e) => setAuthData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                                    />
                                </div>
                                <Button onClick={handlePasswordChange} disabled={isSavingPassword} className="w-full">
                                    {isSavingPassword
                                        ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Updating...</>
                                        : 'Update Password'
                                    }
                                </Button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'system' && (
                        <div className="space-y-6">
                            <div className="flex items-start justify-between pr-8">
                                <div>
                                    <h3 className="text-lg font-semibold tracking-tight">System Limits & Watchdog</h3>
                                    <p className="text-sm text-muted-foreground">Configure alert thresholds and crash detection.</p>
                                </div>
                                {isRemote && (
                                    <Badge variant="outline" className="text-xs shrink-0 ml-2 mt-0.5">
                                        <Info className="w-3 h-3 mr-1" />
                                        Configuring: {activeNode!.name}
                                    </Badge>
                                )}
                            </div>

                            {isSettingsLoading ? <SettingsSkeleton /> : (
                                <>
                                    <div className="space-y-6 bg-muted/10 p-4 border border-border rounded-xl">
                                        <div className="space-y-4">
                                            <div className="flex justify-between items-center">
                                                <Label className="text-base">Host CPU Alert Threshold</Label>
                                                <span className="text-sm font-medium">{settings.host_cpu_limit}%</span>
                                            </div>
                                            <Slider
                                                min={1} max={100} step={1}
                                                value={[parseInt(settings.host_cpu_limit || '90')]}
                                                onValueChange={(v) => handleSettingChange('host_cpu_limit', v[0].toString())}
                                            />
                                        </div>

                                        <div className="space-y-4 pt-2 border-t border-border">
                                            <div className="flex justify-between items-center">
                                                <Label className="text-base">Host RAM Alert Threshold</Label>
                                                <span className="text-sm font-medium">{settings.host_ram_limit}%</span>
                                            </div>
                                            <Slider
                                                min={1} max={100} step={1}
                                                value={[parseInt(settings.host_ram_limit || '90')]}
                                                onValueChange={(v) => handleSettingChange('host_ram_limit', v[0].toString())}
                                            />
                                        </div>

                                        <div className="space-y-4 pt-2 border-t border-border">
                                            <div className="flex justify-between items-center">
                                                <Label className="text-base">Host Disk Alert Threshold</Label>
                                                <span className="text-sm font-medium">{settings.host_disk_limit}%</span>
                                            </div>
                                            <Slider
                                                min={1} max={100} step={1}
                                                value={[parseInt(settings.host_disk_limit || '90')]}
                                                onValueChange={(v) => handleSettingChange('host_disk_limit', v[0].toString())}
                                            />
                                        </div>

                                        <div className="space-y-2 pt-2 border-t border-border">
                                            <Label className="text-base">Docker Janitor Storage Threshold</Label>
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    step={0.5}
                                                    value={settings.docker_janitor_gb}
                                                    onChange={(e) => handleSettingChange('docker_janitor_gb', e.target.value)}
                                                    className="max-w-[150px]"
                                                />
                                                <span className="text-sm text-muted-foreground">GB reclaimable</span>
                                            </div>
                                            <p className="text-xs text-muted-foreground">Alert when unused Docker data exceeds this size.</p>
                                        </div>

                                        <div className="flex items-center justify-between pt-4 border-t border-border">
                                            <div className="space-y-0.5">
                                                <Label htmlFor="global_crash" className="text-base">Global Crash Detection</Label>
                                                <p className="text-xs text-muted-foreground">Watch all containers for unexpected exits</p>
                                            </div>
                                            <Switch
                                                id="global_crash"
                                                checked={settings.global_crash === '1'}
                                                onCheckedChange={(c) => handleSettingChange('global_crash', c ? '1' : '0')}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex justify-end">
                                        <Button onClick={saveSystemSettings} disabled={isSavingSystem}>
                                            {isSavingSystem
                                                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                                                : 'Save Limits'
                                            }
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {activeSection === 'notifications' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight">Notifications & Alerts</h3>
                                <p className="text-sm text-muted-foreground">Configure external integrations for crash alerts.</p>
                            </div>
                            <Tabs defaultValue="discord" className="w-full">
                                <TabsList className="grid w-full grid-cols-3 mb-4">
                                    <TabsTrigger value="discord">Discord</TabsTrigger>
                                    <TabsTrigger value="slack">Slack</TabsTrigger>
                                    <TabsTrigger value="webhook">Webhook</TabsTrigger>
                                </TabsList>
                                <TabsContent value="discord">{renderAgentTab('discord', 'Discord')}</TabsContent>
                                <TabsContent value="slack">{renderAgentTab('slack', 'Slack')}</TabsContent>
                                <TabsContent value="webhook">{renderAgentTab('webhook', 'Custom Webhook')}</TabsContent>
                            </Tabs>
                        </div>
                    )}

                    {activeSection === 'appearance' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight">Appearance</h3>
                                <p className="text-sm text-muted-foreground">Customize Sencho's visual theme.</p>
                            </div>
                            <div className="flex items-center space-x-4 mt-6">
                                <Button
                                    variant={!isDarkMode ? 'default' : 'outline'}
                                    className="w-32 h-20 flex flex-col gap-2 rounded-xl"
                                    onClick={() => setIsDarkMode(false)}
                                >
                                    <Sun className="w-6 h-6" />
                                    Light
                                </Button>
                                <Button
                                    variant={isDarkMode ? 'default' : 'outline'}
                                    className="w-32 h-20 flex flex-col gap-2 rounded-xl"
                                    onClick={() => setIsDarkMode(true)}
                                >
                                    <Moon className="w-6 h-6" />
                                    Dark
                                </Button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'developer' && (
                        <div className="space-y-6">
                            <div className="flex items-start justify-between pr-8">
                                <div>
                                    <h3 className="text-lg font-semibold tracking-tight">Developer</h3>
                                    <p className="text-sm text-muted-foreground">Power user settings for real-time observability and data retention.</p>
                                </div>
                                {isRemote && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Badge variant="secondary" className="text-xs shrink-0 ml-2 mt-0.5 cursor-help">
                                                    <Info className="w-3 h-3 mr-1" />
                                                    Always Local
                                                </Badge>
                                            </TooltipTrigger>
                                            <TooltipContent side="bottom" className="max-w-[220px] text-center">
                                                These settings control this Sencho instance's UI behaviour and are never synced to remote nodes.
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>

                            {isSettingsLoading ? <SettingsSkeleton /> : (
                                <>
                                    <div className="space-y-6 bg-muted/10 p-4 border border-border rounded-xl">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-0.5">
                                                <Label htmlFor="developer_mode" className="text-base">Developer Mode</Label>
                                                <p className="text-xs text-muted-foreground">Enable Real-Time Metrics & Extended Logs</p>
                                            </div>
                                            <Switch
                                                id="developer_mode"
                                                checked={settings.developer_mode === '1'}
                                                onCheckedChange={(c) => handleSettingChange('developer_mode', c ? '1' : '0')}
                                            />
                                        </div>

                                        <div className="space-y-2 pt-4 border-t border-border">
                                            <Label className={`text-base ${settings.developer_mode === '1' ? 'text-muted-foreground' : ''}`}>
                                                Standard Log Polling Rate
                                            </Label>
                                            <Select
                                                value={settings.global_logs_refresh}
                                                onValueChange={(val) => handleSettingChange('global_logs_refresh', val as '1' | '3' | '5' | '10')}
                                                disabled={settings.developer_mode === '1'}
                                            >
                                                <SelectTrigger className="max-w-[200px]">
                                                    <SelectValue placeholder="Select rate" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="1">1 second</SelectItem>
                                                    <SelectItem value="3">3 seconds</SelectItem>
                                                    <SelectItem value="5">5 seconds</SelectItem>
                                                    <SelectItem value="10">10 seconds</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {settings.developer_mode === '1' && (
                                                <p className="text-xs text-amber-500">SSE streaming is active — polling rate is overridden.</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Data Retention (Observability) */}
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <Database className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-sm font-medium text-foreground">Data Retention</span>
                                        </div>
                                        <div className="space-y-4 bg-muted/10 p-4 border border-border rounded-xl">
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="space-y-0.5">
                                                    <Label className="text-base">Container Metrics Retention</Label>
                                                    <p className="text-xs text-muted-foreground">How long to keep per-container CPU/RAM/network history.</p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={8760}
                                                        value={settings.metrics_retention_hours}
                                                        onChange={(e) => handleSettingChange('metrics_retention_hours', e.target.value)}
                                                        className="w-20"
                                                    />
                                                    <span className="text-sm text-muted-foreground w-8">hrs</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between gap-4 pt-4 border-t border-border">
                                                <div className="space-y-0.5">
                                                    <Label className="text-base">Notification Log Retention</Label>
                                                    <p className="text-xs text-muted-foreground">How long to keep alert and notification history.</p>
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={365}
                                                        value={settings.log_retention_days}
                                                        onChange={(e) => handleSettingChange('log_retention_days', e.target.value)}
                                                        className="w-20"
                                                    />
                                                    <span className="text-sm text-muted-foreground w-8">days</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end">
                                        <Button onClick={saveDeveloperSettings} disabled={isSavingDeveloper}>
                                            {isSavingDeveloper
                                                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                                                : 'Save Developer Settings'
                                            }
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {activeSection === 'nodes' && (
                        <NodeManager />
                    )}

                    {activeSection === 'appstore' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight">App Store Registry</h3>
                                <p className="text-sm text-muted-foreground">Configure the template source used by the App Store.</p>
                            </div>

                            {isSettingsLoading ? <SettingsSkeleton /> : (
                                <>
                                    <div className="space-y-6 bg-muted/10 p-4 border border-border rounded-xl">
                                        <div className="space-y-1">
                                            <Label className="text-base">Default Registry</Label>
                                            <p className="text-xs text-muted-foreground">
                                                LinuxServer.io — <span className="font-mono">https://api.linuxserver.io/api/v1/images</span>
                                            </p>
                                            <p className="text-xs text-muted-foreground">Used when no custom registry is set.</p>
                                        </div>

                                        <div className="space-y-3 pt-4 border-t border-border">
                                            <div className="space-y-1">
                                                <Label className="text-base">Custom Registry URL</Label>
                                                <p className="text-xs text-muted-foreground">
                                                    Provide a URL pointing to a <span className="font-medium">Portainer v2</span> compatible template JSON file. Overrides the default registry.
                                                </p>
                                            </div>
                                            <Input
                                                placeholder="https://example.com/templates.json"
                                                value={settings.template_registry_url ?? ''}
                                                onChange={(e) => handleSettingChange('template_registry_url', e.target.value)}
                                            />
                                            <p className="text-xs text-muted-foreground">Leave empty to use the default LinuxServer.io registry.</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleSettingChange('template_registry_url', '')}
                                            disabled={isSavingRegistry || !settings.template_registry_url}
                                        >
                                            Reset to Default
                                        </Button>
                                        <Button onClick={saveRegistrySettings} disabled={isSavingRegistry}>
                                            {isSavingRegistry
                                                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                                                : 'Save & Refresh'
                                            }
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                </div>
            </DialogContent>
        </Dialog>
    );
}
