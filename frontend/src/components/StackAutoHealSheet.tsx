import { useState, useEffect } from 'react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TogglePill } from '@/components/ui/toggle-pill';
import { Combobox } from '@/components/ui/combobox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { PaidGate } from '@/components/PaidGate';

interface AutoHealPolicy {
    id?: number;
    stack_name: string;
    service_name: string | null;
    unhealthy_duration_mins: number;
    cooldown_mins: number;
    max_restarts_per_hour: number;
    auto_disable_after_failures: number;
    enabled: number;
    consecutive_failures: number;
    last_fired_at: number;
    created_at: number;
    updated_at: number;
}

interface AutoHealHistoryEntry {
    id?: number;
    policy_id: number;
    stack_name: string;
    service_name: string | null;
    container_name: string;
    container_id: string;
    action: 'restarted' | 'skipped_user_action' | 'skipped_cooldown' | 'skipped_rate_limit' | 'failed' | 'policy_auto_disabled';
    reason: string;
    success: number;
    error: string | null;
    timestamp: number;
}

interface StackAutoHealSheetProps {
    stackName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const clampNonNegative = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (val !== '' && Number(val) < 0) val = '0';
    setter(val);
};

function actionColorClass(action: AutoHealHistoryEntry['action']): string {
    if (action === 'restarted') return 'text-success';
    if (action === 'failed' || action === 'policy_auto_disabled') return 'text-destructive';
    return 'text-muted-foreground';
}

function actionLabel(action: AutoHealHistoryEntry['action']): string {
    switch (action) {
        case 'restarted': return 'Restarted';
        case 'skipped_user_action': return 'Skipped (user action)';
        case 'skipped_cooldown': return 'Skipped (cooldown)';
        case 'skipped_rate_limit': return 'Skipped (rate limit)';
        case 'failed': return 'Failed';
        case 'policy_auto_disabled': return 'Auto-disabled';
    }
}

interface PolicyRowProps {
    policy: AutoHealPolicy;
    onDelete: (id: number) => void;
    onToggle: (id: number, enabled: boolean) => void;
    deleting: boolean;
    saving: boolean;
}

function PolicyRow({ policy, onDelete, onToggle, deleting, saving }: PolicyRowProps) {
    const [historyOpen, setHistoryOpen] = useState(false);
    const [history, setHistory] = useState<AutoHealHistoryEntry[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    const toggleHistory = async () => {
        if (!historyOpen && history.length === 0 && policy.id != null) {
            setLoadingHistory(true);
            try {
                const res = await apiFetch(`/auto-heal/policies/${policy.id}/history`);
                if (res.ok) {
                    const data: AutoHealHistoryEntry[] = await res.json();
                    setHistory(data);
                } else {
                    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
                    toast.error((err?.message as string) || (err?.error as string) || 'Failed to load history.');
                }
            } catch (e) {
                console.error('[StackAutoHealSheet] Failed to fetch history:', e);
                toast.error('Network error. Could not reach the node.');
            } finally {
                setLoadingHistory(false);
            }
        }
        setHistoryOpen(prev => !prev);
    };

    return (
        <div className="flex flex-col gap-0 rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel text-sm">
            <div className="flex items-center justify-between gap-2 p-3">
                <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-mono text-foreground truncate">
                        {policy.service_name ?? <span className="text-muted-foreground font-sans">All services</span>}
                    </span>
                    <span className="text-muted-foreground text-xs">
                        Unhealthy for {policy.unhealthy_duration_mins} min
                        &bull; Cooldown: {policy.cooldown_mins} min
                        &bull; Max {policy.max_restarts_per_hour}/hr
                    </span>
                    {policy.consecutive_failures > 0 && (
                        <span className="inline-flex items-center gap-1 mt-0.5">
                            <span className="px-1.5 py-0.5 rounded text-xs font-mono tabular-nums text-destructive bg-destructive/10 border border-destructive/20">
                                {policy.consecutive_failures} failure{policy.consecutive_failures !== 1 ? 's' : ''}
                            </span>
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <TogglePill
                        checked={policy.enabled === 1}
                        onChange={(checked) => policy.id != null && onToggle(policy.id, checked)}
                        disabled={saving}
                        aria-label={`Toggle policy for ${policy.service_name ?? 'all services'}`}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={toggleHistory}
                        aria-label="Toggle history"
                        disabled={loadingHistory}
                    >
                        {loadingHistory ? (
                            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                        ) : historyOpen ? (
                            <ChevronUp className="h-4 w-4" strokeWidth={1.5} />
                        ) : (
                            <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
                        )}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive/60 hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => policy.id != null && onDelete(policy.id)}
                        disabled={deleting}
                        aria-label="Delete policy"
                    >
                        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                    </Button>
                </div>
            </div>

            {historyOpen && (
                <div className="border-t border-card-border px-3 pb-3 pt-2 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recent Activity</p>
                    {history.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-2">No history yet.</p>
                    ) : (
                        history.map((entry) => (
                            <div key={entry.id} className="flex items-start gap-2 text-xs">
                                <span className="text-muted-foreground shrink-0 tabular-nums font-mono">
                                    {new Date(entry.timestamp).toLocaleString()}
                                </span>
                                <span className="font-mono text-foreground shrink-0 truncate max-w-[100px]">
                                    {entry.container_name}
                                </span>
                                <span className={`shrink-0 font-medium ${actionColorClass(entry.action)}`}>
                                    {actionLabel(entry.action)}
                                </span>
                                <span className="text-muted-foreground truncate">
                                    {entry.reason}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

export function StackAutoHealSheet({ stackName, open, onOpenChange }: StackAutoHealSheetProps) {
    const [policies, setPolicies] = useState<AutoHealPolicy[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [serviceOptions, setServiceOptions] = useState<{ value: string; label: string }[]>([]);

    // Form state
    const [service, setService] = useState('');
    const [unhealthyFor, setUnhealthyFor] = useState('5');
    const [cooldown, setCooldown] = useState('5');
    const [maxRestarts, setMaxRestarts] = useState('3');
    const [autoDisableAfter, setAutoDisableAfter] = useState('5');

    useEffect(() => {
        if (!open || !stackName) return;

        setLoading(true);
        apiFetch(`/auto-heal/policies?stackName=${encodeURIComponent(stackName)}`)
            .then(res => res.json() as Promise<AutoHealPolicy[]>)
            .then(data => setPolicies(data))
            .catch(() => toast.error('Failed to load auto-heal policies.'))
            .finally(() => setLoading(false));

        apiFetch(`/stacks/${encodeURIComponent(stackName)}/services`)
            .then(res => res.json() as Promise<string[]>)
            .then(names => setServiceOptions(names.map(n => ({ value: n, label: n }))))
            .catch(() => { /* services list is optional, silently skip */ });
    }, [open, stackName]);

    const handleToggle = async (id: number, enabled: boolean) => {
        setSaving(true);
        try {
            const res = await apiFetch(`/auto-heal/policies/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ enabled: enabled ? 1 : 0 }),
            });
            if (res.ok) {
                setPolicies(prev =>
                    prev.map(p => p.id === id ? { ...p, enabled: enabled ? 1 : 0 } : p)
                );
            } else {
                const err = await res.json().catch(() => ({})) as Record<string, unknown>;
                toast.error((err?.message as string) || (err?.error as string) || 'Failed to update policy.');
            }
        } catch (e) {
            console.error('[StackAutoHealSheet] Failed to toggle policy:', e);
            toast.error('Network error. Could not reach the node.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        setDeleting(true);
        try {
            const res = await apiFetch(`/auto-heal/policies/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Policy deleted.');
                setPolicies(prev => prev.filter(p => p.id !== id));
            } else {
                const err = await res.json().catch(() => ({})) as Record<string, unknown>;
                toast.error((err?.message as string) || (err?.error as string) || 'Failed to delete policy.');
            }
        } catch (e) {
            console.error('[StackAutoHealSheet] Failed to delete policy:', e);
            toast.error('Network error. Could not reach the node.');
        } finally {
            setDeleting(false);
        }
    };

    const handleAddPolicy = async () => {
        setSaving(true);
        const body = {
            stack_name: stackName,
            service_name: service === '' ? null : service,
            unhealthy_duration_mins: parseInt(unhealthyFor, 10) || 5,
            cooldown_mins: parseInt(cooldown, 10) || 5,
            max_restarts_per_hour: parseInt(maxRestarts, 10) || 3,
            auto_disable_after_failures: parseInt(autoDisableAfter, 10) || 5,
        };
        try {
            const res = await apiFetch('/auto-heal/policies', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (res.ok) {
                toast.success('Policy added.');
                setService('');
                setUnhealthyFor('5');
                setCooldown('5');
                setMaxRestarts('3');
                setAutoDisableAfter('5');
                apiFetch(`/auto-heal/policies?stackName=${encodeURIComponent(stackName)}`)
                    .then(res => res.json() as Promise<AutoHealPolicy[]>)
                    .then(data => setPolicies(data))
                    .catch(() => toast.error('Failed to reload policies.'));
            } else {
                const err = await res.json().catch(() => ({})) as Record<string, unknown>;
                toast.error((err?.message as string) || (err?.error as string) || 'Failed to add policy.');
                console.error('[StackAutoHealSheet] addPolicy failed:', err);
            }
        } catch (e) {
            console.error('[StackAutoHealSheet] addPolicy threw:', e);
            toast.error('Network error. Could not reach the node.');
        } finally {
            setSaving(false);
        }
    };

    const serviceComboOptions = [
        { value: '', label: 'All services' },
        ...serviceOptions,
    ];

    return (
        <PaidGate featureName="Auto-Heal Policies">
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent className="sm:max-w-[440px] flex flex-col">
                    <SheetHeader>
                        <SheetTitle>Auto-Heal Policies: {stackName}</SheetTitle>
                        <SheetDescription className="sr-only">
                            Configure auto-heal policies to automatically restart unhealthy containers in this stack.
                        </SheetDescription>
                    </SheetHeader>

                    <ScrollArea className="flex-1">
                        <div className="mt-4 space-y-5 pr-2">
                            {/* Existing policies */}
                            <div className="space-y-3">
                                <h4 className="text-sm font-medium">Active Policies</h4>
                                {loading ? (
                                    <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                                        <span>Loading policies...</span>
                                    </div>
                                ) : policies.length === 0 ? (
                                    <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-lg border text-center">
                                        No auto-heal policies configured for this stack.
                                    </div>
                                ) : (
                                    policies.map(policy => (
                                        <PolicyRow
                                            key={policy.id}
                                            policy={policy}
                                            onDelete={handleDelete}
                                            onToggle={handleToggle}
                                            deleting={deleting}
                                            saving={saving}
                                        />
                                    ))
                                )}
                            </div>

                            <hr className="border-card-border" />

                            {/* Add new policy form */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-medium">Add New Policy</h4>

                                <div className="space-y-2">
                                    <Label>Service</Label>
                                    <Combobox
                                        options={serviceComboOptions}
                                        value={service}
                                        onValueChange={setService}
                                        placeholder="All services"
                                        searchPlaceholder="Search services..."
                                        emptyText="No services found."
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="unhealthy-duration">Unhealthy for (minutes)</Label>
                                        <Input
                                            id="unhealthy-duration"
                                            type="text"
                                            inputMode="numeric"
                                            value={unhealthyFor}
                                            onChange={clampNonNegative(setUnhealthyFor)}
                                            placeholder="5"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="cooldown">Cooldown (minutes)</Label>
                                        <Input
                                            id="cooldown"
                                            type="text"
                                            inputMode="numeric"
                                            value={cooldown}
                                            onChange={clampNonNegative(setCooldown)}
                                            placeholder="5"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="max-restarts">Max restarts / hr</Label>
                                        <Input
                                            id="max-restarts"
                                            type="text"
                                            inputMode="numeric"
                                            value={maxRestarts}
                                            onChange={clampNonNegative(setMaxRestarts)}
                                            placeholder="3"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="auto-disable">Auto-disable after (failures)</Label>
                                        <Input
                                            id="auto-disable"
                                            type="text"
                                            inputMode="numeric"
                                            value={autoDisableAfter}
                                            onChange={clampNonNegative(setAutoDisableAfter)}
                                            placeholder="5"
                                        />
                                    </div>
                                </div>

                                <Button
                                    className="w-full mt-2"
                                    onClick={handleAddPolicy}
                                    disabled={saving}
                                >
                                    {saving ? (
                                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" strokeWidth={1.5} />Saving...</>
                                    ) : (
                                        'Add Policy'
                                    )}
                                </Button>
                            </div>
                        </div>
                    </ScrollArea>
                </SheetContent>
            </Sheet>
        </PaidGate>
    );
}
