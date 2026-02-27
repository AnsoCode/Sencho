import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';

interface Agent {
    type: 'discord' | 'slack' | 'webhook';
    url: string;
    enabled: boolean;
}

interface NotificationSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function NotificationSettingsModal({ isOpen, onClose }: NotificationSettingsModalProps) {
    const [agents, setAgents] = useState<Record<string, Agent>>({
        discord: { type: 'discord', url: '', enabled: false },
        slack: { type: 'slack', url: '', enabled: false },
        webhook: { type: 'webhook', url: '', enabled: false },
    });

    const [settings, setSettings] = useState<Record<string, string>>({
        host_cpu_limit: '90',
        host_ram_limit: '90',
        host_disk_limit: '90',
        global_crash: '1',
        docker_janitor_gb: '5'
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
            const res = await fetch('/api/agents');
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
            const res = await fetch('/api/settings');
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
            const res = await fetch('/api/agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(agents[type])
            });
            if (res.ok) {
                toast.success(`${type} settings saved successfully.`);
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
            const res = await fetch('/api/notifications/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key, value })
                });
            }
            toast.success('Global events settings saved.');
        } catch (e) {
            toast.error('Failed to save settings.');
        } finally {
            setIsLoading(false);
        }
    };

    const renderAgentTab = (type: 'discord' | 'slack' | 'webhook', title: string) => (
        <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
                <Label htmlFor={`${type}-enabled`} className="font-semibold">Enable {title} Notifications</Label>
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
            <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                    <DialogTitle>Notification & Alert Settings</DialogTitle>
                    <DialogDescription>
                        Configure where alerts are sent and global system limits.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="global" className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="global">Global</TabsTrigger>
                        <TabsTrigger value="discord">Discord</TabsTrigger>
                        <TabsTrigger value="slack">Slack</TabsTrigger>
                        <TabsTrigger value="webhook">Webhook</TabsTrigger>
                    </TabsList>

                    <TabsContent value="global">
                        <div className="space-y-6 py-4">
                            <div className="space-y-4">
                                <div className="flex justify-between">
                                    <Label>Host CPU Limit (%)</Label>
                                    <span className="text-sm text-muted-foreground">{settings.host_cpu_limit}%</span>
                                </div>
                                <Slider
                                    max={100} step={1}
                                    value={[parseInt(settings.host_cpu_limit || '90')]}
                                    onValueChange={(v) => handleSettingChange('host_cpu_limit', v[0].toString())}
                                />
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between">
                                    <Label>Host RAM Limit (%)</Label>
                                    <span className="text-sm text-muted-foreground">{settings.host_ram_limit}%</span>
                                </div>
                                <Slider
                                    max={100} step={1}
                                    value={[parseInt(settings.host_ram_limit || '90')]}
                                    onValueChange={(v) => handleSettingChange('host_ram_limit', v[0].toString())}
                                />
                            </div>

                            <div className="space-y-4">
                                <div className="flex justify-between">
                                    <Label>Host Disk Limit (%)</Label>
                                    <span className="text-sm text-muted-foreground">{settings.host_disk_limit}%</span>
                                </div>
                                <Slider
                                    max={100} step={1}
                                    value={[parseInt(settings.host_disk_limit || '90')]}
                                    onValueChange={(v) => handleSettingChange('host_disk_limit', v[0].toString())}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Docker Janitor Alert Threshold (GB)</Label>
                                <Input
                                    type="number"
                                    value={settings.docker_janitor_gb}
                                    onChange={(e) => handleSettingChange('docker_janitor_gb', e.target.value)}
                                />
                            </div>

                            <div className="flex items-center justify-between pt-2">
                                <Label htmlFor="global_crash" className="font-semibold">Global Crash Detection (Any Container)</Label>
                                <Switch
                                    id="global_crash"
                                    checked={settings.global_crash === '1'}
                                    onCheckedChange={(c) => handleSettingChange('global_crash', c ? '1' : '0')}
                                />
                            </div>

                            <div className="flex justify-end pt-4">
                                <Button onClick={saveSettings} disabled={isLoading}>Save Global Settings</Button>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="discord">{renderAgentTab('discord', 'Discord')}</TabsContent>
                    <TabsContent value="slack">{renderAgentTab('slack', 'Slack')}</TabsContent>
                    <TabsContent value="webhook">{renderAgentTab('webhook', 'Custom Webhook')}</TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
