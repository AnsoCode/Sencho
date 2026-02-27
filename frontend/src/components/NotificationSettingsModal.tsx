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
import { apiFetch } from '@/lib/api';
import { Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface StackAlert {
    id?: number;
    stack_name: string;
    metric: string;
    operator: string;
    threshold: number;
    duration_mins: number;
    cooldown_mins: number;
}

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

    // Central Alerts State
    const [alerts, setAlerts] = useState<StackAlert[]>([]);
    const [stacks, setStacks] = useState<string[]>([]);
    const [newAlertStack, setNewAlertStack] = useState('');
    const [newAlertMetric, setNewAlertMetric] = useState('cpu_percent');
    const [newAlertOperator, setNewAlertOperator] = useState('>');
    const [newAlertThreshold, setNewAlertThreshold] = useState('');
    const [newAlertDuration, setNewAlertDuration] = useState('5');
    const [newAlertCooldown, setNewAlertCooldown] = useState('60');

    const metricLabels: Record<string, string> = {
        cpu_percent: 'CPU Usage (%)',
        memory_percent: 'Memory Usage (%)',
        memory_mb: 'Memory Usage (MB)',
        net_rx: 'Network In (MB)',
        net_tx: 'Network Out (MB)',
        restart_count: 'Restart Count'
    };

    useEffect(() => {
        if (isOpen) {
            fetchAgents();
            fetchSettings();
            fetchAlerts();
            fetchStacks();
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

    const fetchAlerts = async () => {
        try {
            const res = await apiFetch('/alerts');
            if (res.ok) {
                const data = await res.json();
                setAlerts(data);
            }
        } catch (e) {
            console.error('Failed to fetch alerts', e);
        }
    };

    const fetchStacks = async () => {
        try {
            const res = await apiFetch('/stacks');
            if (res.ok) {
                const data = await res.json();
                setStacks(data);
                if (data.length > 0 && !newAlertStack) {
                    setNewAlertStack(data[0]);
                }
            }
        } catch (e) {
            console.error('Failed to fetch stacks', e);
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
            toast.success('Global events settings saved.');
        } catch (e) {
            toast.error('Failed to save settings.');
        } finally {
            setIsLoading(false);
        }
    };

    const addAlert = async () => {
        if (!newAlertStack) {
            toast.error('Please select a stack.');
            return;
        }
        if (!newAlertThreshold) {
            toast.error('Please enter a threshold.');
            return;
        }

        setIsLoading(true);
        const newAlert = {
            stack_name: newAlertStack,
            metric: newAlertMetric,
            operator: newAlertOperator,
            threshold: parseFloat(newAlertThreshold),
            duration_mins: parseInt(newAlertDuration, 10),
            cooldown_mins: parseInt(newAlertCooldown, 10)
        };

        try {
            const res = await apiFetch('/alerts', {
                method: 'POST',
                body: JSON.stringify(newAlert)
            });
            if (res.ok) {
                toast.success('Alert rule added.');
                setNewAlertThreshold('');
                fetchAlerts();
            } else {
                toast.error('Failed to add alert rule.');
            }
        } catch (e) {
            toast.error('Network error.');
        } finally {
            setIsLoading(false);
        }
    };

    const deleteAlert = async (id: number) => {
        setIsLoading(true);
        try {
            const res = await apiFetch(`/alerts/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Alert rule deleted.');
                fetchAlerts();
            } else {
                toast.error('Failed to delete alert rule.');
            }
        } catch (e) {
            toast.error('Network error.');
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
                    <TabsList className="grid w-full grid-cols-5">
                        <TabsTrigger value="global">Global</TabsTrigger>
                        <TabsTrigger value="discord">Discord</TabsTrigger>
                        <TabsTrigger value="slack">Slack</TabsTrigger>
                        <TabsTrigger value="webhook">Webhook</TabsTrigger>
                        <TabsTrigger value="rules">Alert Rules</TabsTrigger>
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

                    <TabsContent value="rules">
                        <div className="space-y-6 py-4">
                            <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
                                <h4 className="text-sm font-semibold sticky top-0 bg-background pb-2 z-10">Existing Rules</h4>
                                {alerts.length === 0 ? (
                                    <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-lg text-center">
                                        No active alert rules across all stacks.
                                    </div>
                                ) : (
                                    alerts.map(alert => (
                                        <div key={alert.id} className="flex flex-col gap-2 p-3 bg-muted/50 rounded-lg border text-sm">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <span className="font-semibold text-foreground">
                                                        [{alert.stack_name}] {metricLabels[alert.metric] || alert.metric} {alert.operator} {alert.threshold}
                                                    </span>
                                                    <div className="text-muted-foreground mt-1 text-xs">
                                                        Trigger after {alert.duration_mins}m • Cooldown: {alert.cooldown_mins}m
                                                    </div>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                                                    onClick={() => alert.id && deleteAlert(alert.id)}
                                                    disabled={isLoading}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <hr />

                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold">Add New Rule</h4>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Target Stack</Label>
                                        <Select value={newAlertStack} onValueChange={setNewAlertStack}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a stack" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {stacks.map(stack => (
                                                    <SelectItem key={stack} value={stack}>{stack}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Metric</Label>
                                        <Select value={newAlertMetric} onValueChange={setNewAlertMetric}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Object.entries(metricLabels).map(([val, label]) => (
                                                    <SelectItem key={val} value={val}>{label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Operator</Label>
                                        <Select value={newAlertOperator} onValueChange={setNewAlertOperator}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value=">">Greater than</SelectItem>
                                                <SelectItem value=">=">Greater or eq</SelectItem>
                                                <SelectItem value="<">Less than</SelectItem>
                                                <SelectItem value="<=">Less or eq</SelectItem>
                                                <SelectItem value="==">Equals</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Threshold</Label>
                                        <Input
                                            type="number"
                                            value={newAlertThreshold}
                                            onChange={e => setNewAlertThreshold(e.target.value)}
                                            placeholder="e.g. 90"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Duration (mins)</Label>
                                        <Input
                                            type="number"
                                            value={newAlertDuration}
                                            onChange={e => setNewAlertDuration(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Cooldown (mins)</Label>
                                        <Input
                                            type="number"
                                            value={newAlertCooldown}
                                            onChange={e => setNewAlertCooldown(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <Button className="w-full mt-2" onClick={addAlert} disabled={isLoading}>
                                    Add Rule
                                </Button>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
