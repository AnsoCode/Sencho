import { useState, useEffect } from 'react';
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
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Activity, Bell, Palette, Moon, Sun, Code } from 'lucide-react';

interface Agent {
    type: 'discord' | 'slack' | 'webhook';
    url: string;
    enabled: boolean;
}

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    isDarkMode: boolean;
    setIsDarkMode: (mode: boolean) => void;
}

export function SettingsModal({ isOpen, onClose, isDarkMode, setIsDarkMode }: SettingsModalProps) {
    const [activeSection, setActiveSection] = useState<'account' | 'system' | 'notifications' | 'appearance' | 'developer'>('account');

    // Auth State
    const [authData, setAuthData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });

    // Notifications State
    const [agents, setAgents] = useState<Record<string, Agent>>({
        discord: { type: 'discord', url: '', enabled: false },
        slack: { type: 'slack', url: '', enabled: false },
        webhook: { type: 'webhook', url: '', enabled: false },
    });

    // System Settings State
    const [settings, setSettings] = useState<Record<string, string>>({
        host_cpu_limit: '90',
        host_ram_limit: '90',
        host_disk_limit: '90',
        global_crash: '1',
        docker_janitor_gb: '5',
        global_logs_refresh: '5',
        developer_mode: '0'
    });

    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchAgents();
            fetchSettings();
        }
    }, [isOpen]);

    const fetchAgents = async () => {
        try {
            const res = await apiFetch('/agents');
            if (res.ok) {
                const data: Agent[] = await res.json();
                const newAgents = { ...agents };
                data.forEach(a => {
                    newAgents[a.type] = a;
                });
                setAgents(newAgents);
            }
        } catch (e) {
            console.error('Failed to fetch agents', e);
        }
    };

    const fetchSettings = async () => {
        try {
            const res = await apiFetch('/settings');
            if (res.ok) {
                const data = await res.json();
                setSettings(prev => ({ ...prev, ...data }));
            }
        } catch (e) {
            console.error('Failed to fetch settings', e);
        }
    };

    const handleAgentChange = (type: string, field: keyof Agent, value: any) => {
        setAgents(prev => ({
            ...prev,
            [type]: { ...prev[type], [field]: value }
        }));
    };

    const handleSettingChange = (key: string, value: string) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const saveAgent = async (type: string) => {
        setIsLoading(true);
        try {
            const res = await apiFetch('/agents', {
                method: 'POST',
                body: JSON.stringify(agents[type])
            });
            if (res.ok) {
                toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} settings saved successfully.`);
            } else {
                toast.error(`Failed to save ${type} settings.`);
            }
        } catch (e) {
            toast.error('Network error.');
        } finally {
            setIsLoading(false);
        }
    };

    const testAgent = async (type: string) => {
        if (!agents[type].url) {
            toast.error('Please enter a webhook URL first.');
            return;
        }
        setIsLoading(true);
        try {
            const res = await apiFetch('/notifications/test', {
                method: 'POST',
                body: JSON.stringify({ type, url: agents[type].url })
            });
            if (res.ok) {
                toast.success('Test notification sent!');
            } else {
                const err = await res.json();
                toast.error(err.details || 'Test failed.');
            }
        } catch (e) {
            toast.error('Network error.');
        } finally {
            setIsLoading(false);
        }
    };

    const saveSettings = async () => {
        setIsLoading(true);
        try {
            for (const [key, value] of Object.entries(settings)) {
                await apiFetch('/settings', {
                    method: 'POST',
                    body: JSON.stringify({ key, value })
                });
            }
            toast.success('System limits & watchdog settings saved.');
        } catch (e) {
            toast.error('Failed to save settings.');
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasswordChange = async () => {
        if (!authData.oldPassword || !authData.newPassword || !authData.confirmPassword) {
            toast.error("All fields are required");
            return;
        }
        if (authData.newPassword !== authData.confirmPassword) {
            toast.error("New passwords do not match");
            return;
        }

        setIsLoading(true);
        try {
            const res = await apiFetch('/auth/password', {
                method: 'PUT',
                body: JSON.stringify({
                    oldPassword: authData.oldPassword,
                    newPassword: authData.newPassword
                })
            });

            if (res.ok) {
                toast.success('Password updated successfully');
                setAuthData({ oldPassword: '', newPassword: '', confirmPassword: '' });
            } else {
                const data = await res.json();
                toast.error(data.error || 'Failed to update password');
            }
        } catch (e) {
            toast.error('Network error during password change');
        } finally {
            setIsLoading(false);
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
                <Button variant="outline" onClick={() => testAgent(type)} disabled={isLoading}>Test</Button>
                <Button onClick={() => saveAgent(type)} disabled={isLoading}>Save</Button>
            </div>
        </div>
    );

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[800px] h-[600px] flex p-0 font-sans shadow-lg bg-background border-border overflow-hidden gap-0">
                {/* Sidebar */}
                <div className="w-[200px] bg-muted/20 border-r border-border flex flex-col p-4 shrink-0">
                    <div className="font-semibold text-lg mb-6 text-foreground tracking-tight">Settings Hub</div>
                    <nav className="space-y-1.5 flex flex-col">
                        <Button
                            variant={activeSection === 'account' ? 'secondary' : 'ghost'}
                            className="w-full justify-start font-medium"
                            onClick={() => setActiveSection('account')}
                        >
                            <Shield className="w-4 h-4 mr-2" />
                            Account
                        </Button>
                        <Button
                            variant={activeSection === 'system' ? 'secondary' : 'ghost'}
                            className="w-full justify-start font-medium"
                            onClick={() => setActiveSection('system')}
                        >
                            <Activity className="w-4 h-4 mr-2" />
                            System Limits
                        </Button>
                        <Button
                            variant={activeSection === 'notifications' ? 'secondary' : 'ghost'}
                            className="w-full justify-start font-medium"
                            onClick={() => setActiveSection('notifications')}
                        >
                            <Bell className="w-4 h-4 mr-2" />
                            Notifications
                        </Button>
                        <Button
                            variant={activeSection === 'appearance' ? 'secondary' : 'ghost'}
                            className="w-full justify-start font-medium"
                            onClick={() => setActiveSection('appearance')}
                        >
                            <Palette className="w-4 h-4 mr-2" />
                            Appearance
                        </Button>
                        <Button
                            variant={activeSection === 'developer' ? 'secondary' : 'ghost'}
                            className="w-full justify-start font-medium"
                            onClick={() => setActiveSection('developer')}
                        >
                            <Code className="w-4 h-4 mr-2" />
                            Developer
                        </Button>
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
                                <Button onClick={handlePasswordChange} disabled={isLoading} className="w-full">
                                    Update Password
                                </Button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'system' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight">System Limits & Watchdog</h3>
                                <p className="text-sm text-muted-foreground">Configure auto-recovery thresholds and server constraints.</p>
                            </div>

                            <div className="space-y-6 bg-muted/10 p-4 border border-border rounded-xl">
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-base">Host CPU Limit</Label>
                                        <span className="text-sm font-medium">{settings.host_cpu_limit}%</span>
                                    </div>
                                    <Slider
                                        max={100} step={1}
                                        value={[parseInt(settings.host_cpu_limit || '90')]}
                                        onValueChange={(v) => handleSettingChange('host_cpu_limit', v[0].toString())}
                                    />
                                </div>

                                <div className="space-y-4 pt-2 border-t border-border">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-base">Host RAM Limit</Label>
                                        <span className="text-sm font-medium">{settings.host_ram_limit}%</span>
                                    </div>
                                    <Slider
                                        max={100} step={1}
                                        value={[parseInt(settings.host_ram_limit || '90')]}
                                        onValueChange={(v) => handleSettingChange('host_ram_limit', v[0].toString())}
                                    />
                                </div>

                                <div className="space-y-4 pt-2 border-t border-border">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-base">Host Disk Limit</Label>
                                        <span className="text-sm font-medium">{settings.host_disk_limit}%</span>
                                    </div>
                                    <Slider
                                        max={100} step={1}
                                        value={[parseInt(settings.host_disk_limit || '90')]}
                                        onValueChange={(v) => handleSettingChange('host_disk_limit', v[0].toString())}
                                    />
                                </div>

                                <div className="space-y-2 pt-2 border-t border-border">
                                    <Label className="text-base">Docker Janitor Storage Threshold (GB)</Label>
                                    <Input
                                        type="number"
                                        value={settings.docker_janitor_gb}
                                        onChange={(e) => handleSettingChange('docker_janitor_gb', e.target.value)}
                                        className="max-w-[200px]"
                                    />
                                </div>

                                <div className="flex items-center justify-between pt-4 border-t border-border">
                                    <div className="space-y-0.5">
                                        <Label htmlFor="global_crash" className="text-base">Global Crash Detection</Label>
                                        <p className="text-xs text-muted-foreground">Watch all containers indefinitely</p>
                                    </div>
                                    <Switch
                                        id="global_crash"
                                        checked={settings.global_crash === '1'}
                                        onCheckedChange={(c) => handleSettingChange('global_crash', c ? '1' : '0')}
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end mt-4">
                                <Button onClick={saveSettings} disabled={isLoading}>Save Limits</Button>
                            </div>
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
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight">Developer</h3>
                                <p className="text-sm text-muted-foreground">Power user settings for real-time observability and extended diagnostics.</p>
                            </div>

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
                                    <Label className={`text-base ${settings.developer_mode === '1' ? 'text-muted-foreground' : ''}`}>Standard Log Polling Rate</Label>
                                    <Select
                                        value={settings.global_logs_refresh}
                                        onValueChange={(val) => handleSettingChange('global_logs_refresh', val)}
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
                                        <p className="text-xs text-amber-500">SSE streaming is active — polling rate is overridden by real-time streaming.</p>
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-end mt-4">
                                <Button onClick={saveSettings} disabled={isLoading}>Save Developer Settings</Button>
                            </div>
                        </div>
                    )}

                </div>
            </DialogContent>
        </Dialog>
    );
}
