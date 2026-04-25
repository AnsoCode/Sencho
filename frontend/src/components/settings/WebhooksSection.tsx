import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { TogglePill } from '@/components/ui/toggle-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { PaidGate } from '@/components/PaidGate';
import { CapabilityGate } from '@/components/CapabilityGate';
import {
    RefreshCw, CheckCircle, XCircle, Webhook, Copy, Trash2,
    Plus, ChevronDown, ChevronRight, History,
} from 'lucide-react';

interface WebhookItem {
    id: number;
    name: string;
    stack_name: string;
    action: string;
    secret: string;
    enabled: boolean;
    created_at: number;
    updated_at: number;
}

interface WebhookExecution {
    id: number;
    webhook_id: number;
    action: string;
    status: 'success' | 'failure';
    trigger_source: string | null;
    duration_ms: number | null;
    error: string | null;
    executed_at: number;
}

export function WebhooksSection({ isPaid }: { isPaid: boolean }) {
    const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [newSecret, setNewSecret] = useState<{ id: number; secret: string } | null>(null);
    const [expandedHistory, setExpandedHistory] = useState<number | null>(null);
    const [history, setHistory] = useState<Record<number, WebhookExecution[]>>({});
    const [loadingHistory, setLoadingHistory] = useState<number | null>(null);

    // Form state
    const [formName, setFormName] = useState('');
    const [formStack, setFormStack] = useState('');
    const [formAction, setFormAction] = useState<string>('deploy');
    const [stacks, setStacks] = useState<string[]>([]);

    const fetchWebhooks = async () => {
        try {
            const res = await apiFetch('/webhooks', { localOnly: true });
            if (res.ok) setWebhooks(await res.json());
        } catch { /* ignore */ } finally { setLoading(false); }
    };

    const fetchStacks = async () => {
        try {
            const res = await apiFetch('/stacks');
            if (res.ok) setStacks(await res.json());
        } catch { /* ignore */ }
    };

    useEffect(() => { fetchWebhooks(); fetchStacks(); }, []);

    const handleCreate = async () => {
        if (!formName || !formStack || !formAction) {
            toast.error('All fields are required.');
            return;
        }
        setCreating(true);
        try {
            const res = await apiFetch('/webhooks', {
                method: 'POST',
                localOnly: true,
                body: JSON.stringify({ name: formName, stack_name: formStack, action: formAction }),
            });
            if (res.ok) {
                const data = await res.json();
                setNewSecret({ id: data.id, secret: data.secret });
                setShowForm(false);
                setFormName(''); setFormStack(''); setFormAction('deploy');
                fetchWebhooks();
                toast.success('Webhook created.');
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to create webhook.');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Network error.');
        } finally { setCreating(false); }
    };

    const handleDelete = async (id: number) => {
        try {
            const res = await apiFetch(`/webhooks/${id}`, { method: 'DELETE', localOnly: true });
            if (res.ok) { toast.success('Webhook deleted.'); fetchWebhooks(); }
            else { const err = await res.json().catch(() => ({})); toast.error(err?.error || 'Failed to delete.'); }
        } catch { toast.error('Network error.'); }
    };

    const handleToggle = async (id: number, enabled: boolean) => {
        try {
            const res = await apiFetch(`/webhooks/${id}`, {
                method: 'PUT', localOnly: true,
                body: JSON.stringify({ enabled }),
            });
            if (res.ok) fetchWebhooks();
        } catch { /* ignore */ }
    };

    const fetchHistory = async (webhookId: number) => {
        if (expandedHistory === webhookId) { setExpandedHistory(null); return; }
        setExpandedHistory(webhookId);
        setLoadingHistory(webhookId);
        try {
            const res = await apiFetch(`/webhooks/${webhookId}/history`, { localOnly: true });
            if (res.ok) {
                const data = await res.json();
                setHistory(prev => ({ ...prev, [webhookId]: data }));
            }
        } catch { /* ignore */ } finally { setLoadingHistory(null); }
    };

    const handleCopy = async (text: string, label: string) => {
        try {
            await copyToClipboard(text);
            toast.success(`${label} copied to clipboard.`);
        } catch {
            toast.error('Failed to copy to clipboard.');
        }
    };

    if (!isPaid) {
        return (
            <div className="space-y-6">
                <PaidGate featureName="Webhooks">
                  <CapabilityGate capability="webhooks" featureName="Webhooks">
                    <div className="space-y-3">
                        <div className="h-16 rounded-lg border bg-card" />
                        <div className="h-16 rounded-lg border bg-card" />
                    </div>
                  </CapabilityGate>
                </PaidGate>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <Button size="sm" onClick={() => setShowForm(!showForm)}>
                    <Plus className="w-4 h-4 mr-1.5" /> Create Webhook
                </Button>
            </div>

            {/* Create Form */}
            {showForm && (
                <div className="space-y-4 bg-glass border border-glass-border p-4 rounded-lg">
                    <div className="space-y-2">
                        <Label>Name</Label>
                        <Input placeholder="Deploy on push" value={formName} onChange={e => setFormName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label>Stack</Label>
                        <Select value={formStack} onValueChange={setFormStack}>
                            <SelectTrigger><SelectValue placeholder="Select a stack..." /></SelectTrigger>
                            <SelectContent>
                                {stacks.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Action</Label>
                        <Select value={formAction} onValueChange={setFormAction}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="deploy">Deploy (down + up)</SelectItem>
                                <SelectItem value="restart">Restart</SelectItem>
                                <SelectItem value="stop">Stop</SelectItem>
                                <SelectItem value="start">Start</SelectItem>
                                <SelectItem value="pull">Pull & Update</SelectItem>
                                <SelectItem value="git-pull">Git source sync</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleCreate} disabled={creating}>
                            {creating ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />Creating...</> : 'Create'}
                        </Button>
                    </div>
                </div>
            )}

            {/* Secret reveal (shown once after creation) */}
            {newSecret && (
                <div className="bg-success-muted border border-success/30 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-success">
                        <CheckCircle className="w-4 h-4" /> Webhook created - copy your secret now
                    </div>
                    <p className="text-xs text-muted-foreground">This secret will not be shown again. Store it securely.</p>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded-lg break-all">{newSecret.secret}</code>
                        <Button variant="outline" size="sm" onClick={() => handleCopy(newSecret.secret, 'Secret')}>
                            <Copy className="w-4 h-4" />
                        </Button>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setNewSecret(null)}>Dismiss</Button>
                </div>
            )}

            {/* Loading state */}
            {loading && (
                <div className="space-y-3">
                    <Skeleton className="h-20 w-full rounded-lg" />
                    <Skeleton className="h-20 w-full rounded-lg" />
                </div>
            )}

            {/* Empty state */}
            {!loading && webhooks.length === 0 && !showForm && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Webhook className="w-10 h-10 text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">No webhooks configured yet.</p>
                    <p className="text-xs text-muted-foreground mt-1">Create one to trigger stack actions from CI/CD.</p>
                </div>
            )}

            {/* Webhook list */}
            {!loading && webhooks.map(wh => {
                const triggerUrl = `${window.location.origin}/api/webhooks/${wh.id}/trigger`;
                const isExpanded = expandedHistory === wh.id;
                return (
                    <div key={wh.id} className="border border-glass-border rounded-lg overflow-hidden">
                        <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Webhook className="w-4 h-4 text-muted-foreground shrink-0" />
                                    <span className="font-medium text-sm truncate">{wh.name}</span>
                                    <Badge variant="outline" className="text-[10px] shrink-0">{wh.action}</Badge>
                                    <Badge variant="secondary" className="text-[10px] shrink-0">{wh.stack_name}</Badge>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <TogglePill checked={wh.enabled} onChange={(c) => handleToggle(wh.id!, c)} />
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleDelete(wh.id!)}>
                                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                                    </Button>
                                </div>
                            </div>

                            {/* Trigger URL */}
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Trigger URL</Label>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 text-[11px] font-mono bg-muted px-2.5 py-1.5 rounded-md truncate">{triggerUrl}</code>
                                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => handleCopy(triggerUrl, 'URL')}>
                                        <Copy className="w-3 h-3" />
                                    </Button>
                                </div>
                            </div>

                            {/* Secret (masked) */}
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground">Secret:</span>
                                <code className="font-mono text-muted-foreground">{wh.secret}</code>
                            </div>

                            {/* History toggle */}
                            <button
                                onClick={() => fetchHistory(wh.id!)}
                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                <History className="w-3 h-3" />
                                Recent executions
                            </button>
                        </div>

                        {/* Execution history */}
                        {isExpanded && (
                            <div className="border-t bg-muted/20 px-4 py-3">
                                {loadingHistory === wh.id ? (
                                    <Skeleton className="h-8 w-full" />
                                ) : (history[wh.id!] ?? []).length === 0 ? (
                                    <p className="text-xs text-muted-foreground">No executions yet.</p>
                                ) : (
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                        {(history[wh.id!] ?? []).map(ex => (
                                            <div key={ex.id} className="flex items-center gap-2 text-xs">
                                                {ex.status === 'success'
                                                    ? <CheckCircle className="w-3 h-3 text-success shrink-0" />
                                                    : <XCircle className="w-3 h-3 text-red-500 shrink-0" />}
                                                <span className="font-medium">{ex.action}</span>
                                                <span className="text-muted-foreground">
                                                    {new Date(ex.executed_at).toLocaleString()}
                                                </span>
                                                {ex.duration_ms !== null && (
                                                    <span className="text-muted-foreground">{(ex.duration_ms / 1000).toFixed(1)}s</span>
                                                )}
                                                {ex.error && (
                                                    <span className="text-red-500 truncate" title={ex.error}>{ex.error}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
