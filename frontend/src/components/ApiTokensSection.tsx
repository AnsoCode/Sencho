import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { AdmiralGate } from './AdmiralGate';
import { CapabilityGate } from './CapabilityGate';
import { TierBadge } from './TierBadge';
import { Zap, Plus, Copy, Trash2, CheckCircle, RefreshCw, Clock } from 'lucide-react';

interface ApiTokenListItem {
    id: number;
    name: string;
    scope: string;
    created_at: number;
    last_used_at: number | null;
    expires_at: number | null;
    revoked_at: number | null;
}

const SCOPE_LABELS: Record<string, string> = {
    'read-only': 'Read Only',
    'deploy-only': 'Deploy Only',
    'full-admin': 'Full Admin',
};

const SCOPE_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
    'read-only': 'default',
    'deploy-only': 'secondary',
    'full-admin': 'destructive',
};

function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRelative(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(ts);
}

export function ApiTokensSection() {
    const [tokens, setTokens] = useState<ApiTokenListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [newToken, setNewToken] = useState<{ id: number; token: string } | null>(null);

    const [formName, setFormName] = useState('');
    const [formScope, setFormScope] = useState('read-only');
    const [formExpiry, setFormExpiry] = useState<number | null>(null);

    const fetchTokens = async () => {
        try {
            const res = await apiFetch('/api-tokens', { localOnly: true });
            if (res.ok) {
                const data: ApiTokenListItem[] = await res.json();
                setTokens(data.filter(t => !t.revoked_at));
            }
        } catch { toast.error('Failed to load API tokens.'); } finally { setLoading(false); }
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchTokens(); }, []);

    const handleCreate = async () => {
        if (!formName.trim()) {
            toast.error('Token name is required.');
            return;
        }
        setCreating(true);
        try {
            const res = await apiFetch('/api-tokens', {
                method: 'POST',
                localOnly: true,
                body: JSON.stringify({ name: formName.trim(), scope: formScope, expires_in: formExpiry }),
            });
            if (res.ok) {
                const data = await res.json();
                setNewToken({ id: data.id, token: data.token });
                setShowForm(false);
                setFormName('');
                setFormScope('read-only');
                setFormExpiry(null);
                fetchTokens();
                toast.success('API token created.');
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to create token.');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Network error.');
        } finally { setCreating(false); }
    };

    const handleRevoke = async (id: number) => {
        try {
            const res = await apiFetch(`/api-tokens/${id}`, { method: 'DELETE', localOnly: true });
            if (res.ok) {
                toast.success('API token revoked.');
                fetchTokens();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to revoke token.');
            }
        } catch { toast.error('Network error.'); }
    };

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        toast.success(`${label} copied to clipboard.`);
    };

    return (
        <AdmiralGate featureName="API Tokens">
          <CapabilityGate capability="api-tokens" featureName="API Tokens">
            <div className="space-y-6">
                <div className="flex items-start justify-between pr-8">
                    <div>
                        <h3 className="text-lg font-medium tracking-tight flex items-center gap-2">
                            API Tokens <TierBadge />
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Generate scoped tokens for CI/CD pipelines, scripts, and automation.
                        </p>
                    </div>
                    <Button size="sm" onClick={() => setShowForm(!showForm)}>
                        <Plus className="w-4 h-4 mr-1.5" /> Create Token
                    </Button>
                </div>

                {/* Create form */}
                {showForm && (
                    <div className="space-y-4 bg-muted/10 p-4 border border-border rounded-xl">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input
                                placeholder="CI deploy pipeline"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Permission Scope</Label>
                            <Select value={formScope} onValueChange={setFormScope}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="read-only">Read Only - GET requests only</SelectItem>
                                    <SelectItem value="deploy-only">Deploy Only - read + deploy actions</SelectItem>
                                    <SelectItem value="full-admin">Full Admin - unrestricted access</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Expiration</Label>
                            <Select value={formExpiry === null ? 'never' : String(formExpiry)} onValueChange={v => setFormExpiry(v === 'never' ? null : Number(v))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="30">30 days</SelectItem>
                                    <SelectItem value="60">60 days</SelectItem>
                                    <SelectItem value="90">90 days</SelectItem>
                                    <SelectItem value="365">1 year</SelectItem>
                                    <SelectItem value="never">No expiration</SelectItem>
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

                {/* Token reveal (shown once after creation) */}
                {newToken && (
                    <div className="bg-success-muted border border-success/30 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-success">
                            <CheckCircle className="w-4 h-4" /> Token created - copy it now
                        </div>
                        <p className="text-xs text-muted-foreground">This token will not be shown again. Store it securely.</p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded-lg break-all select-all">{newToken.token}</code>
                            <Button variant="outline" size="sm" onClick={() => copyToClipboard(newToken.token, 'Token')}>
                                <Copy className="w-4 h-4" />
                            </Button>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setNewToken(null)}>Dismiss</Button>
                    </div>
                )}

                {/* Loading state */}
                {loading && (
                    <div className="space-y-3">
                        <Skeleton className="h-20 w-full rounded-xl" />
                        <Skeleton className="h-20 w-full rounded-xl" />
                    </div>
                )}

                {/* Empty state */}
                {!loading && tokens.length === 0 && !showForm && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Zap className="w-10 h-10 text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">No API tokens yet.</p>
                        <p className="text-xs text-muted-foreground mt-1">Create one to authenticate CI/CD pipelines and scripts.</p>
                    </div>
                )}

                {/* Token list */}
                {!loading && tokens.map(token => (
                    <div key={token.id} className="border border-border rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                                <Zap className="w-4 h-4 text-muted-foreground shrink-0" />
                                <span className="font-medium text-sm truncate">{token.name}</span>
                                <Badge variant={SCOPE_BADGE_VARIANT[token.scope] || 'default'} className="text-[10px] shrink-0">
                                    {SCOPE_LABELS[token.scope] || token.scope}
                                </Badge>
                            </div>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive shrink-0">
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Revoke API token?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Revoking <strong>{token.name}</strong> will immediately invalidate it. Any pipelines or scripts using this token will stop working.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleRevoke(token.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                            Revoke
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Created {formatDate(token.created_at)}
                            </span>
                            <span>
                                Last used: {token.last_used_at ? formatRelative(token.last_used_at) : 'Never'}
                            </span>
                            {token.expires_at && (
                                <span className={token.expires_at < Date.now() ? 'text-destructive' : ''}>
                                    {token.expires_at < Date.now() ? 'Expired' : `Expires ${formatDate(token.expires_at)}`}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
          </CapabilityGate>
        </AdmiralGate>
    );
}
