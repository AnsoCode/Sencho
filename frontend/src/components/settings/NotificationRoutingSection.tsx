import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Combobox } from '@/components/ui/combobox';
import type { ComboboxOption } from '@/components/ui/combobox';
import { Tabs, TabsList, TabsTrigger, TabsHighlight, TabsHighlightItem } from '@/components/ui/tabs';
import { springs } from '@/lib/motion';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { AdmiralGate } from '@/components/AdmiralGate';
import { CapabilityGate } from '@/components/CapabilityGate';
import { Plus, Trash2, Pencil, RefreshCw, Zap, X, Route } from 'lucide-react';

interface NotificationRoute {
    id: number;
    name: string;
    stack_patterns: string[];
    channel_type: 'discord' | 'slack' | 'webhook';
    channel_url: string;
    priority: number;
    enabled: boolean;
    created_at: number;
    updated_at: number;
}

const CHANNEL_LABELS: Record<string, string> = {
    discord: 'Discord',
    slack: 'Slack',
    webhook: 'Webhook',
};

const CHANNEL_PLACEHOLDERS: Record<string, string> = {
    discord: 'https://discord.com/api/webhooks/...',
    slack: 'https://hooks.slack.com/services/...',
    webhook: 'https://example.com/webhook',
};

export function NotificationRoutingSection() {
    const [routes, setRoutes] = useState<NotificationRoute[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [testingId, setTestingId] = useState<number | null>(null);
    const [stackOptions, setStackOptions] = useState<ComboboxOption[]>([]);

    // Form state
    const [formName, setFormName] = useState('');
    const [formStacks, setFormStacks] = useState<string[]>([]);
    const [formChannelType, setFormChannelType] = useState<'discord' | 'slack' | 'webhook'>('discord');
    const [formChannelUrl, setFormChannelUrl] = useState('');
    const [formPriority, setFormPriority] = useState(0);
    const [formEnabled, setFormEnabled] = useState(true);

    const fetchRoutes = useCallback(async () => {
        try {
            const res = await apiFetch('/notification-routes');
            if (res.ok) {
                setRoutes(await res.json());
            }
        } catch {
            toast.error('Failed to load notification routes.');
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchStacks = useCallback(async () => {
        try {
            const res = await apiFetch('/stacks');
            if (res.ok) {
                const data: string[] = await res.json();
                setStackOptions(data.map((s) => ({ value: s, label: s })));
            }
        } catch {
            // Stacks may fail on remote nodes, non-critical
        }
    }, []);

    useEffect(() => {
        fetchRoutes();
        fetchStacks();
    }, [fetchRoutes, fetchStacks]);

    const resetForm = () => {
        setFormName('');
        setFormStacks([]);
        setFormChannelType('discord');
        setFormChannelUrl('');
        setFormPriority(0);
        setFormEnabled(true);
        setEditingId(null);
        setShowForm(false);
    };

    const startEdit = (route: NotificationRoute) => {
        setEditingId(route.id);
        setFormName(route.name);
        setFormStacks([...route.stack_patterns]);
        setFormChannelType(route.channel_type);
        setFormChannelUrl(route.channel_url);
        setFormPriority(route.priority);
        setFormEnabled(route.enabled);
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!formName.trim()) { toast.error('Name is required.'); return; }
        if (formStacks.length === 0) { toast.error('At least one stack must be selected.'); return; }
        if (!formChannelUrl.trim() || !formChannelUrl.startsWith('https://')) {
            toast.error('Channel URL must be a valid HTTPS URL.');
            return;
        }

        setSaving(true);
        try {
            const body = {
                name: formName.trim(),
                stack_patterns: formStacks,
                channel_type: formChannelType,
                channel_url: formChannelUrl.trim(),
                priority: formPriority,
                enabled: formEnabled,
            };

            const url = editingId ? `/notification-routes/${editingId}` : '/notification-routes';
            const method = editingId ? 'PUT' : 'POST';

            const res = await apiFetch(url, {
                method,
                body: JSON.stringify(body),
            });

            if (res.ok) {
                toast.success(editingId ? 'Route updated.' : 'Route created.');
                resetForm();
                fetchRoutes();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || err?.data?.error || 'Something went wrong.');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Network error.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            const res = await apiFetch(`/notification-routes/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Route deleted.');
                fetchRoutes();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || err?.data?.error || 'Something went wrong.');
            }
        } catch {
            toast.error('Network error.');
        }
    };

    const handleTest = async (id: number) => {
        setTestingId(id);
        try {
            const res = await apiFetch(`/notification-routes/${id}/test`, { method: 'POST' });
            if (res.ok) {
                toast.success('Test notification sent!');
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.details || err?.error || 'Test failed.');
            }
        } catch {
            toast.error('Network error.');
        } finally {
            setTestingId(null);
        }
    };

    const handleToggleEnabled = async (route: NotificationRoute) => {
        try {
            const res = await apiFetch(`/notification-routes/${route.id}`, {
                method: 'PUT',
                body: JSON.stringify({ enabled: !route.enabled }),
            });
            if (res.ok) {
                fetchRoutes();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || err?.data?.error || 'Something went wrong.');
            }
        } catch {
            toast.error('Network error.');
        }
    };

    const addStack = (stackName: string) => {
        if (stackName && !formStacks.includes(stackName)) {
            setFormStacks(prev => [...prev, stackName]);
        }
    };

    const removeStack = (stackName: string) => {
        setFormStacks(prev => prev.filter(s => s !== stackName));
    };

    const availableStackOptions = stackOptions.filter(o => !formStacks.includes(o.value));

    return (
        <AdmiralGate featureName="Notification Routing">
          <CapabilityGate capability="notification-routing" featureName="Notification Routing">
            <div className="space-y-6">
                <div className="flex justify-end">
                    <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
                        <Plus className="w-4 h-4 mr-1.5" /> Add Route
                    </Button>
                </div>

                <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogTitle>{editingId ? 'Edit Route' : 'New Routing Rule'}</DialogTitle>
                        <DialogDescription className="sr-only">
                            {editingId ? 'Edit a notification routing rule' : 'Create a notification routing rule'}
                        </DialogDescription>

                        <div className="space-y-4 pt-2">
                            <div className="space-y-2">
                                <Label>Name</Label>
                                <Input
                                    placeholder="e.g. Production alerts"
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                    maxLength={100}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Stacks</Label>
                                <Combobox
                                    options={availableStackOptions}
                                    value=""
                                    onValueChange={addStack}
                                    placeholder="Add a stack..."
                                    searchPlaceholder="Search stacks..."
                                    emptyText="No stacks found."
                                />
                                {formStacks.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {formStacks.map(s => (
                                            <Badge key={s} variant="secondary" className="font-mono text-xs gap-1 pr-1">
                                                {s}
                                                <button
                                                    type="button"
                                                    onClick={() => removeStack(s)}
                                                    className="ml-0.5 rounded-full hover:bg-foreground/10 p-0.5"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label>Channel</Label>
                                <Tabs value={formChannelType} onValueChange={(v) => setFormChannelType(v as 'discord' | 'slack' | 'webhook')}>
                                    <TabsList className="w-full grid grid-cols-3">
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
                                </Tabs>
                                <Input
                                    placeholder={CHANNEL_PLACEHOLDERS[formChannelType]}
                                    value={formChannelUrl}
                                    onChange={e => setFormChannelUrl(e.target.value)}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Priority</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={formPriority}
                                        onChange={e => setFormPriority(parseInt(e.target.value, 10) || 0)}
                                    />
                                    <p className="text-xs text-muted-foreground">Lower values are evaluated first.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label>Enabled</Label>
                                    <div className="pt-2">
                                        <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2 pt-2">
                                <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
                                <Button size="sm" onClick={handleSave} disabled={saving}>
                                    {saving ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />Saving...</> : editingId ? 'Update' : 'Create'}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                {loading && (
                    <div className="space-y-3">
                        <Skeleton className="h-20 w-full rounded-xl" />
                        <Skeleton className="h-20 w-full rounded-xl" />
                    </div>
                )}

                {!loading && routes.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Route className="w-10 h-10 text-muted-foreground/50 mb-3" strokeWidth={1.5} />
                        <p className="text-sm text-muted-foreground">No routing rules configured.</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Alerts will use your global notification channels. Add a route to direct specific stack alerts to dedicated channels.
                        </p>
                    </div>
                )}

                {!loading && routes.map(route => (
                    <div
                        key={route.id}
                        className="rounded-lg border border-card-border border-t-card-border-top bg-card text-card-foreground shadow-card-bevel transition-colors hover:border-t-card-border-hover p-4 space-y-3"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                                <Route className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} />
                                <span className="font-medium text-sm truncate">{route.name}</span>
                                <Badge variant="outline" className="text-[10px] shrink-0">
                                    {CHANNEL_LABELS[route.channel_type]}
                                </Badge>
                                {!route.enabled && (
                                    <Badge variant="secondary" className="text-[10px] shrink-0 text-muted-foreground">
                                        Disabled
                                    </Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <Switch
                                    checked={route.enabled}
                                    onCheckedChange={() => handleToggleEnabled(route)}
                                    className="scale-75"
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleTest(route.id)}
                                    disabled={testingId === route.id}
                                    title="Send test notification"
                                >
                                    {testingId === route.id ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Zap className="w-4 h-4" strokeWidth={1.5} />
                                    )}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => startEdit(route)} title="Edit">
                                    <Pencil className="w-4 h-4" strokeWidth={1.5} />
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive/60 hover:bg-destructive hover:text-destructive-foreground"
                                            title="Delete"
                                        >
                                            <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Delete routing rule?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Deleting <strong>{route.name}</strong> will remove this routing rule. Alerts for the associated stacks will fall back to your global notification channels.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={() => handleDelete(route.id)}
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                                Delete
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <div className="flex flex-wrap gap-1">
                                {route.stack_patterns.map(s => (
                                    <Badge key={s} variant="secondary" className="font-mono text-[10px]">{s}</Badge>
                                ))}
                            </div>
                            <span className="text-muted-foreground/50">|</span>
                            <span className="font-mono truncate max-w-[200px]" title={route.channel_url}>
                                {route.channel_url}
                            </span>
                            {route.priority !== 0 && (
                                <>
                                    <span className="text-muted-foreground/50">|</span>
                                    <span className="tabular-nums">Priority: {route.priority}</span>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
          </CapabilityGate>
        </AdmiralGate>
    );
}
