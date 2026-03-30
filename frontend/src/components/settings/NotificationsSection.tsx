import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from '@/components/ui/tabs';
import { springs } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { useNodes } from '@/context/NodeContext';
import { RefreshCw, Info } from 'lucide-react';
import type { Agent } from './types';

export function NotificationsSection() {
    const { activeNode } = useNodes();
    const isRemote = activeNode?.type === 'remote';

    const [notifTab, setNotifTab] = useState<'discord' | 'slack' | 'webhook'>('discord');
    const [agents, setAgents] = useState<Record<string, Agent>>({
        discord: { type: 'discord', url: '', enabled: false },
        slack: { type: 'slack', url: '', enabled: false },
        webhook: { type: 'webhook', url: '', enabled: false },
    });
    const [isSavingAgent, setIsSavingAgent] = useState<Record<string, boolean>>({});
    const [isTestingAgent, setIsTestingAgent] = useState<Record<string, boolean>>({});

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

    useEffect(() => { fetchAgents(); }, [activeNode?.id]);

    const handleAgentChange = (type: string, field: keyof Agent, value: Agent[keyof Agent]) => {
        setAgents(prev => ({
            ...prev,
            [type]: { ...prev[type], [field]: value },
        }));
    };

    const saveAgent = async (type: string) => {
        setIsSavingAgent(prev => ({ ...prev, [type]: true }));
        try {
            const res = await apiFetch('/agents', {
                method: 'POST',
                body: JSON.stringify(agents[type]),
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
                body: JSON.stringify({ type, url: agents[type].url }),
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

    const renderAgentTab = (type: 'discord' | 'slack' | 'webhook', title: string) => (
        <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
                <Label htmlFor={`${type}-enabled`} className="font-medium">Enable {title}</Label>
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

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between pr-8">
                <div>
                    <h3 className="text-lg font-medium tracking-tight">Notifications & Alerts</h3>
                    <p className="text-sm text-muted-foreground">
                        {isRemote
                            ? <>Configuring notification channels on <span className="font-medium text-foreground">{activeNode!.name}</span>. Alerts from this remote node will dispatch via these channels.</>
                            : 'Configure external integrations for crash alerts.'
                        }
                    </p>
                </div>
                {isRemote && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Badge variant="secondary" className="text-xs shrink-0 ml-2 mt-0.5 cursor-help">
                                    <Info className="w-3 h-3 mr-1" />
                                    Remote
                                </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[240px] text-center">
                                These channels are saved on the remote Sencho instance and used when it dispatches alerts.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>
            <Tabs value={notifTab} onValueChange={(v) => setNotifTab(v as 'discord' | 'slack' | 'webhook')} className="w-full">
                <TabsList className="w-full mb-4 grid grid-cols-3">
                    <TabsHighlight className="rounded-md bg-glass-highlight" transition={springs.snappy}>
                        <TabsHighlightItem value="discord">
                            <TabsTrigger value="discord">Discord</TabsTrigger>
                        </TabsHighlightItem>
                        <TabsHighlightItem value="slack">
                            <TabsTrigger value="slack">Slack</TabsTrigger>
                        </TabsHighlightItem>
                        <TabsHighlightItem value="webhook">
                            <TabsTrigger value="webhook">Webhook</TabsTrigger>
                        </TabsHighlightItem>
                    </TabsHighlight>
                </TabsList>
                <TabsContent value="discord">{renderAgentTab('discord', 'Discord')}</TabsContent>
                <TabsContent value="slack">{renderAgentTab('slack', 'Slack')}</TabsContent>
                <TabsContent value="webhook">{renderAgentTab('webhook', 'Custom Webhook')}</TabsContent>
            </Tabs>
        </div>
    );
}
