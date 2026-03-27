import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
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
import { Shield, Activity, Bell, Code, Server, Package, RefreshCw, Database, Info, Crown, CheckCircle, XCircle, Clock, Webhook, Copy, Trash2, Plus, ChevronDown, ChevronRight, History, Users, Pencil, ExternalLink, CreditCard } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { NodeManager } from './NodeManager';
import { useNodes } from '@/context/NodeContext';
import { useAuth } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { ProBadge } from './ProBadge';
import { ProGate } from './ProGate';

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

type SectionId = 'account' | 'license' | 'users' | 'system' | 'notifications' | 'webhooks' | 'developer' | 'nodes' | 'appstore' | 'about';

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

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
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

function WebhooksSection({ isPro }: { isPro: boolean }) {
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

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        toast.success(`${label} copied to clipboard.`);
    };

    if (!isPro) {
        return (
            <div className="space-y-6">
                <div>
                    <h3 className="text-lg font-semibold tracking-tight flex items-center gap-2">Webhooks <ProBadge /></h3>
                    <p className="text-sm text-muted-foreground">Trigger stack actions from CI/CD pipelines via HTTP.</p>
                </div>
                <ProGate featureName="Webhooks">
                    <div className="space-y-3">
                        <div className="h-16 rounded-xl border bg-card" />
                        <div className="h-16 rounded-xl border bg-card" />
                    </div>
                </ProGate>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between pr-8">
                <div>
                    <h3 className="text-lg font-semibold tracking-tight flex items-center gap-2">Webhooks <ProBadge /></h3>
                    <p className="text-sm text-muted-foreground">Trigger stack actions from CI/CD pipelines via HTTP.</p>
                </div>
                <Button size="sm" onClick={() => setShowForm(!showForm)}>
                    <Plus className="w-4 h-4 mr-1.5" /> Create Webhook
                </Button>
            </div>

            {/* Create Form */}
            {showForm && (
                <div className="space-y-4 bg-muted/10 p-4 border border-border rounded-xl">
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
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="w-4 h-4" /> Webhook created - copy your secret now
                    </div>
                    <p className="text-xs text-muted-foreground">This secret will not be shown again. Store it securely.</p>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded-lg break-all">{newSecret.secret}</code>
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(newSecret.secret, 'Secret')}>
                            <Copy className="w-4 h-4" />
                        </Button>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setNewSecret(null)}>Dismiss</Button>
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
                    <div key={wh.id} className="border border-border rounded-xl overflow-hidden">
                        <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Webhook className="w-4 h-4 text-muted-foreground shrink-0" />
                                    <span className="font-medium text-sm truncate">{wh.name}</span>
                                    <Badge variant="outline" className="text-[10px] shrink-0">{wh.action}</Badge>
                                    <Badge variant="secondary" className="text-[10px] shrink-0">{wh.stack_name}</Badge>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Switch checked={wh.enabled} onCheckedChange={(c) => handleToggle(wh.id!, c)} />
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
                                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => copyToClipboard(triggerUrl, 'URL')}>
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
                                                    ? <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
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

interface UserItem {
    id: number;
    username: string;
    role: 'admin' | 'viewer';
    created_at: number;
}

function UsersSection() {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState<UserItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingUser, setEditingUser] = useState<UserItem | null>(null);
    const [saving, setSaving] = useState(false);

    // Form state
    const [formUsername, setFormUsername] = useState('');
    const [formPassword, setFormPassword] = useState('');
    const [formConfirmPassword, setFormConfirmPassword] = useState('');
    const [formRole, setFormRole] = useState<'admin' | 'viewer'>('viewer');

    const fetchUsers = async () => {
        try {
            const res = await apiFetch('/users', { localOnly: true });
            if (res.ok) setUsers(await res.json());
        } catch { /* ignore */ } finally { setLoading(false); }
    };

    useEffect(() => { fetchUsers(); }, []);

    const resetForm = () => {
        setFormUsername('');
        setFormPassword('');
        setFormConfirmPassword('');
        setFormRole('viewer');
        setEditingUser(null);
        setShowForm(false);
    };

    const handleSave = async () => {
        if (!formUsername || formUsername.length < 3) {
            toast.error('Username must be at least 3 characters.');
            return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(formUsername)) {
            toast.error('Username can only contain letters, numbers, underscores, and hyphens.');
            return;
        }
        if (!editingUser && !formPassword) {
            toast.error('Password is required for new users.');
            return;
        }
        if (formPassword && formPassword.length < 6) {
            toast.error('Password must be at least 6 characters.');
            return;
        }
        if (formPassword && formPassword !== formConfirmPassword) {
            toast.error('Passwords do not match.');
            return;
        }
        setSaving(true);
        try {
            if (editingUser) {
                const body: Record<string, string> = { username: formUsername, role: formRole };
                if (formPassword) body.password = formPassword;
                const res = await apiFetch(`/users/${editingUser.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    localOnly: true,
                });
                if (!res.ok) {
                    const err = await res.json();
                    toast.error(err?.error || err?.message || 'Failed to update user.');
                    return;
                }
                toast.success('User updated.');
            } else {
                const res = await apiFetch('/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: formUsername, password: formPassword, role: formRole }),
                    localOnly: true,
                });
                if (!res.ok) {
                    const err = await res.json();
                    toast.error(err?.error || err?.message || 'Failed to create user.');
                    return;
                }
                toast.success('User created.');
            }
            resetForm();
            fetchUsers();
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Something went wrong.';
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (userId: number) => {
        try {
            const res = await apiFetch(`/users/${userId}`, { method: 'DELETE', localOnly: true });
            if (!res.ok) {
                const err = await res.json();
                toast.error(err?.error || err?.message || 'Failed to delete user.');
                return;
            }
            toast.success('User deleted.');
            fetchUsers();
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Something went wrong.';
            toast.error(msg);
        }
    };

    const startEdit = (u: UserItem) => {
        setEditingUser(u);
        setFormUsername(u.username);
        setFormRole(u.role);
        setFormPassword('');
        setFormConfirmPassword('');
        setShowForm(true);
    };

    return (
        <ProGate featureName="User management">
            <div className="space-y-6">
                <div className="flex items-start justify-between pr-8">
                    <div>
                        <h3 className="text-lg font-semibold tracking-tight">User Management</h3>
                        <p className="text-sm text-muted-foreground">Create and manage user accounts with role-based access control.</p>
                    </div>
                    {!showForm && (
                        <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
                            <Plus className="w-4 h-4 mr-1" />Add User
                        </Button>
                    )}
                </div>

                {/* Add/Edit Form */}
                {showForm && (
                    <div className="space-y-4 bg-muted/10 p-4 border border-border rounded-xl">
                        <h4 className="text-sm font-medium">{editingUser ? 'Edit User' : 'New User'}</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Username</Label>
                                <Input
                                    value={formUsername}
                                    onChange={(e) => setFormUsername(e.target.value)}
                                    placeholder="username"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Role</Label>
                                <Select value={formRole} onValueChange={(v) => setFormRole(v as 'admin' | 'viewer')}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="admin">Admin</SelectItem>
                                        <SelectItem value="viewer">Viewer</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>{editingUser ? 'New Password (optional)' : 'Password'}</Label>
                                <Input
                                    type="password"
                                    value={formPassword}
                                    onChange={(e) => setFormPassword(e.target.value)}
                                    placeholder={editingUser ? 'Leave blank to keep' : 'min. 6 characters'}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Confirm Password</Label>
                                <Input
                                    type="password"
                                    value={formConfirmPassword}
                                    onChange={(e) => setFormConfirmPassword(e.target.value)}
                                    placeholder="Confirm password"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
                            <Button size="sm" onClick={handleSave} disabled={saving}>
                                {saving ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" />Saving...</> : (editingUser ? 'Update User' : 'Create User')}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Users Table */}
                {loading ? (
                    <div className="space-y-3">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-12 w-full" />
                    </div>
                ) : users.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">No users found.</div>
                ) : (
                    <div className="border border-border rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-muted/30 border-b border-border">
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Username</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Role</th>
                                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Created</th>
                                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((u) => {
                                    const isSelf = u.username === currentUser?.username;
                                    return (
                                        <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                                            <td className="px-4 py-2.5 font-medium">
                                                {u.username}
                                                {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <Badge variant={u.role === 'admin' ? 'default' : 'secondary'} className="text-xs capitalize">
                                                    {u.role}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-2.5 text-muted-foreground">
                                                {new Date(u.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-4 py-2.5 text-right">
                                                <div className="flex gap-1 justify-end">
                                                    <Button variant="ghost" size="sm" onClick={() => startEdit(u)}>
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </Button>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="sm" disabled={isSelf}>
                                                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete user "{u.username}"?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This action cannot be undone. The user will lose access immediately.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleDelete(u.id)}>Delete</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </ProGate>
    );
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { activeNode } = useNodes();
    const { isAdmin } = useAuth();
    const { license, isPro, activate, deactivate, checkout } = useLicense();
    const isRemote = activeNode?.type === 'remote';
    const [activeSection, setActiveSection] = useState<SectionId>('account');
    const [licenseKeyInput, setLicenseKeyInput] = useState('');
    const [isActivating, setIsActivating] = useState(false);
    const [isDeactivating, setIsDeactivating] = useState(false);

    // When switching to a remote node, reset to a node-scoped section if on a global-only one
    useEffect(() => {
        if (isRemote && (activeSection === 'account' || activeSection === 'license' || activeSection === 'users' || activeSection === 'notifications' || activeSection === 'webhooks' || activeSection === 'nodes' || activeSection === 'appstore')) {
            setActiveSection('system');
        }
    }, [isRemote]); // eslint-disable-line react-hooks/exhaustive-deps

    // Notification tab state (controlled for sliding indicator)
    const [notifTab, setNotifTab] = useState<'discord' | 'slack' | 'webhook'>('discord');

    // Auth State
    const [authData, setAuthData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });

    // Notification agents state
    const [agents, setAgents] = useState<Record<string, Agent>>({
        discord: { type: 'discord', url: '', enabled: false },
        slack: { type: 'slack', url: '', enabled: false },
        webhook: { type: 'webhook', url: '', enabled: false },
    });

    // Settings state - all user-configurable keys (no auth keys)
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
        settings.host_cpu_limit !== serverSettingsRef.current.host_cpu_limit ||
        settings.host_ram_limit !== serverSettingsRef.current.host_ram_limit ||
        settings.host_disk_limit !== serverSettingsRef.current.host_disk_limit ||
        settings.docker_janitor_gb !== serverSettingsRef.current.docker_janitor_gb ||
        settings.global_crash !== serverSettingsRef.current.global_crash;

    const hasDeveloperChanges =
        settings.developer_mode !== serverSettingsRef.current.developer_mode ||
        settings.global_logs_refresh !== serverSettingsRef.current.global_logs_refresh ||
        settings.metrics_retention_hours !== serverSettingsRef.current.metrics_retention_hours ||
        settings.log_retention_days !== serverSettingsRef.current.log_retention_days;

    useEffect(() => {
        if (isOpen) {
            fetchAgents();
            fetchSettings();
        }
    }, [isOpen, activeNode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
            // Always fetch developer/UI preferences from local - these control
            // this Sencho instance's behaviour and must never be proxied to remote
            const localRes = isRemote ? await apiFetch('/settings', { localOnly: true }) : nodeRes;

            const nodeData: Record<string, string> = nodeRes.ok ? await nodeRes.json() : {};
            const localData: Record<string, string> = (isRemote && localRes.ok)
                ? await localRes.json()
                : nodeData;

            const safe: PatchableSettings = {
                // Per-node: read from active node
                host_cpu_limit: nodeData.host_cpu_limit ?? DEFAULT_SETTINGS.host_cpu_limit,
                host_ram_limit: nodeData.host_ram_limit ?? DEFAULT_SETTINGS.host_ram_limit,
                host_disk_limit: nodeData.host_disk_limit ?? DEFAULT_SETTINGS.host_disk_limit,
                docker_janitor_gb: nodeData.docker_janitor_gb ?? DEFAULT_SETTINGS.docker_janitor_gb,
                global_crash: (nodeData.global_crash as '0' | '1') ?? DEFAULT_SETTINGS.global_crash,
                template_registry_url: nodeData.template_registry_url ?? '',
                // Local-only: always read from local node
                global_logs_refresh: (localData.global_logs_refresh as '1' | '3' | '5' | '10') ?? DEFAULT_SETTINGS.global_logs_refresh,
                developer_mode: (localData.developer_mode as '0' | '1') ?? DEFAULT_SETTINGS.developer_mode,
                metrics_retention_hours: localData.metrics_retention_hours ?? DEFAULT_SETTINGS.metrics_retention_hours,
                log_retention_days: localData.log_retention_days ?? DEFAULT_SETTINGS.log_retention_days,
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
        // Developer/UI preferences are local-only - never proxy to remote node
        const ok = await patchSettings({
            developer_mode: settings.developer_mode,
            global_logs_refresh: settings.global_logs_refresh,
            metrics_retention_hours: settings.metrics_retention_hours,
            log_retention_days: settings.log_retention_days,
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
                <VisuallyHidden><DialogTitle>Settings Hub</DialogTitle></VisuallyHidden>
                <VisuallyHidden><DialogDescription>Configure Sencho settings</DialogDescription></VisuallyHidden>
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
                        {!isRemote && (
                            <NavButton section="license" icon={<Crown className="w-4 h-4 mr-2" />} label="License" />
                        )}
                        {!isRemote && isAdmin && (
                            <NavButton section="users" icon={<Users className="w-4 h-4 mr-2" />} label="Users" />
                        )}
                        <NavButton
                            section="system"
                            icon={<Activity className="w-4 h-4 mr-2" />}
                            label="System Limits"
                            showDot={hasSystemChanges}
                        />
                        <NavButton section="notifications" icon={<Bell className="w-4 h-4 mr-2" />} label="Notifications" />
                        {!isRemote && (
                            <NavButton section="webhooks" icon={<Webhook className="w-4 h-4 mr-2" />} label="Webhooks" />
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
                        <NavButton section="about" icon={<Info className="w-4 h-4 mr-2" />} label="About" />
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

                    {activeSection === 'license' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight">License</h3>
                                <p className="text-sm text-muted-foreground">Manage your Sencho Pro license.</p>
                            </div>

                            {/* Current Tier Display */}
                            <div className="bg-muted/10 p-4 border border-border rounded-xl space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {license?.tier === 'pro' ? (
                                            <CheckCircle className="w-5 h-5 text-green-500" />
                                        ) : (
                                            <Crown className="w-5 h-5 text-muted-foreground" />
                                        )}
                                        <span className="font-medium text-base">
                                            {license?.tier === 'pro' ? 'Sencho Pro' : 'Sencho Community'}
                                        </span>
                                    </div>
                                    {license?.tier === 'pro' && <ProBadge />}
                                </div>

                                {license?.status === 'trial' && license.trialDaysRemaining !== null && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Clock className="w-4 h-4" />
                                        <span>Trial: {license.trialDaysRemaining} day{license.trialDaysRemaining !== 1 ? 's' : ''} remaining</span>
                                    </div>
                                )}

                                {license?.status === 'active' && (
                                    <div className="space-y-2 text-sm">
                                        {license.customerName && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Customer</span>
                                                <span>{license.customerName}</span>
                                            </div>
                                        )}
                                        {license.productName && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Plan</span>
                                                <span>{license.productName}</span>
                                            </div>
                                        )}
                                        {license.maskedKey && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">License Key</span>
                                                <span className="font-mono text-xs">{license.maskedKey}</span>
                                            </div>
                                        )}
                                        {license.validUntil && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Renews</span>
                                                <span>{new Date(license.validUntil).toLocaleDateString()}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {license?.status === 'expired' && (
                                    <div className="flex items-center gap-2 text-sm text-destructive">
                                        <XCircle className="w-4 h-4" />
                                        <span>Your Pro license has expired. Renew to restore Pro features.</span>
                                    </div>
                                )}

                                {license?.status === 'disabled' && (
                                    <div className="flex items-center gap-2 text-sm text-destructive">
                                        <XCircle className="w-4 h-4" />
                                        <span>Your license has been disabled. Contact support for assistance.</span>
                                    </div>
                                )}
                            </div>

                            {/* Manage Subscription (active Pro) */}
                            {license?.status === 'active' && (
                                <div className="space-y-3">
                                    {license.portalUrl && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => window.open(license.portalUrl!, '_blank')}
                                        >
                                            <CreditCard className="w-4 h-4 mr-2" />
                                            Manage Subscription
                                            <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                                        </Button>
                                    )}
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm text-muted-foreground">
                                            Deactivating will revert to Community features.
                                        </p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={async () => {
                                                setIsDeactivating(true);
                                                const result = await deactivate();
                                                if (result.success) {
                                                    toast.success('License deactivated.');
                                                } else {
                                                    toast.error(result.error || 'Deactivation failed');
                                                }
                                                setIsDeactivating(false);
                                            }}
                                            disabled={isDeactivating}
                                        >
                                            {isDeactivating
                                                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Deactivating...</>
                                                : 'Deactivate License'
                                            }
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Subscribe / Activate (not active) */}
                            {license?.status !== 'active' && (
                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <Label className="text-base">Subscribe to Sencho Pro</Label>
                                        <p className="text-xs text-muted-foreground">
                                            Purchase a license key from our website, then activate it below.
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        onClick={() => checkout()}
                                    >
                                        <Crown className="w-4 h-4 mr-2" />
                                        View Pricing
                                        <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                                    </Button>

                                    {/* License key activation */}
                                    <div className="border-t border-border pt-4 space-y-2">
                                        <Label className="text-sm text-muted-foreground">Have a license key?</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                                                value={licenseKeyInput}
                                                onChange={(e) => setLicenseKeyInput(e.target.value)}
                                                className="font-mono"
                                            />
                                            <Button
                                                variant="outline"
                                                onClick={async () => {
                                                    if (!licenseKeyInput.trim()) return;
                                                    setIsActivating(true);
                                                    const result = await activate(licenseKeyInput.trim());
                                                    if (result.success) {
                                                        toast.success('License activated! Welcome to Sencho Pro.');
                                                        setLicenseKeyInput('');
                                                    } else {
                                                        toast.error(result.error || 'Activation failed');
                                                    }
                                                    setIsActivating(false);
                                                }}
                                                disabled={isActivating || !licenseKeyInput.trim()}
                                            >
                                                {isActivating
                                                    ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Activating...</>
                                                    : 'Activate'
                                                }
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )}
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
                            <div className="flex items-start justify-between pr-8">
                                <div>
                                    <h3 className="text-lg font-semibold tracking-tight">Notifications & Alerts</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {isRemote
                                            ? <>Configuring notification channels on <span className="font-semibold text-foreground">{activeNode!.name}</span>. Alerts from this remote node will dispatch via these channels.</>
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
                                    <TabsTrigger value="discord" className="relative data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                                        {notifTab === 'discord' && (
                                            <motion.div layoutId="notif-tab-indicator" className="absolute inset-0 rounded-md bg-background shadow-sm" transition={{ type: 'spring', stiffness: 350, damping: 30 }} />
                                        )}
                                        <span className="relative z-10">Discord</span>
                                    </TabsTrigger>
                                    <TabsTrigger value="slack" className="relative data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                                        {notifTab === 'slack' && (
                                            <motion.div layoutId="notif-tab-indicator" className="absolute inset-0 rounded-md bg-background shadow-sm" transition={{ type: 'spring', stiffness: 350, damping: 30 }} />
                                        )}
                                        <span className="relative z-10">Slack</span>
                                    </TabsTrigger>
                                    <TabsTrigger value="webhook" className="relative data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                                        {notifTab === 'webhook' && (
                                            <motion.div layoutId="notif-tab-indicator" className="absolute inset-0 rounded-md bg-background shadow-sm" transition={{ type: 'spring', stiffness: 350, damping: 30 }} />
                                        )}
                                        <span className="relative z-10">Webhook</span>
                                    </TabsTrigger>
                                </TabsList>
                                <TabsContent value="discord">{renderAgentTab('discord', 'Discord')}</TabsContent>
                                <TabsContent value="slack">{renderAgentTab('slack', 'Slack')}</TabsContent>
                                <TabsContent value="webhook">{renderAgentTab('webhook', 'Custom Webhook')}</TabsContent>
                            </Tabs>
                        </div>
                    )}

                    {activeSection === 'webhooks' && (
                        <WebhooksSection isPro={isPro} />
                    )}

                    {activeSection === 'users' && (
                        <UsersSection />
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
                                                <p className="text-xs text-amber-500">SSE streaming is active - polling rate is overridden.</p>
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

                    {activeSection === 'about' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold tracking-tight">About Sencho</h3>
                                <p className="text-sm text-muted-foreground">Version and instance information.</p>
                            </div>

                            <div className="space-y-4 bg-muted/10 p-4 border border-border rounded-xl">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">Version</span>
                                    <Badge variant="secondary" className="font-mono">v{__APP_VERSION__}</Badge>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">Tier</span>
                                    <div>{license?.tier === 'pro' ? <ProBadge /> : <Badge variant="outline">Community</Badge>}</div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-muted-foreground">License Status</span>
                                    <Badge variant="outline" className="capitalize">{license?.status ?? 'community'}</Badge>
                                </div>
                                {license?.instanceId && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Instance ID</span>
                                        <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{license.instanceId.slice(0, 8)}</code>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <h4 className="text-sm font-medium">Links</h4>
                                <div className="flex flex-col gap-1.5">
                                    <a
                                        href="https://docs.sencho.io"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        Documentation &rarr;
                                    </a>
                                    <a
                                        href="https://github.com/AnsoCode/Sencho/blob/main/CHANGELOG.md"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        Changelog &rarr;
                                    </a>
                                    <a
                                        href="https://github.com/AnsoCode/Sencho/issues"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        Report an Issue &rarr;
                                    </a>
                                </div>
                            </div>
                        </div>
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
                                                LinuxServer.io - <span className="font-mono">https://api.linuxserver.io/api/v1/images</span>
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
