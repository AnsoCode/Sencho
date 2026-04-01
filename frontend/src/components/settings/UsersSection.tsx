import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { useAuth, type UserRole } from '@/context/AuthContext';
import { useLicense } from '@/context/LicenseContext';
import { ProGate } from '@/components/ProGate';
import { RefreshCw, Trash2, Plus, Pencil } from 'lucide-react';

interface UserItem {
    id: number;
    username: string;
    role: UserRole;
    created_at: number;
}

interface RoleAssignmentItem {
    id: number;
    user_id: number;
    role: UserRole;
    resource_type: 'stack' | 'node';
    resource_id: string;
    created_at: number;
}

export function UsersSection() {
    const { user: currentUser } = useAuth();
    const { isPro, license } = useLicense();
    const [users, setUsers] = useState<UserItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingUser, setEditingUser] = useState<UserItem | null>(null);
    const [saving, setSaving] = useState(false);

    // Form state
    const [formUsername, setFormUsername] = useState('');
    const [formPassword, setFormPassword] = useState('');
    const [formConfirmPassword, setFormConfirmPassword] = useState('');
    const [formRole, setFormRole] = useState<UserRole>('viewer');

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
        fetchRoleAssignments(u.id);
        fetchScopeResources();
    };

    // --- Scoped Role Assignments ---
    const [roleAssignments, setRoleAssignments] = useState<RoleAssignmentItem[]>([]);
    const [scopeResourceType, setScopeResourceType] = useState<'stack' | 'node'>('stack');
    const [scopeResourceId, setScopeResourceId] = useState('');
    const [scopeRole, setScopeRole] = useState<UserRole>('deployer');
    const [availableStacks, setAvailableStacks] = useState<string[]>([]);
    const [availableNodes, setAvailableNodes] = useState<{ id: number; name: string }[]>([]);
    const [addingScope, setAddingScope] = useState(false);

    const fetchRoleAssignments = async (userId: number) => {
        try {
            const res = await apiFetch(`/users/${userId}/roles`, { localOnly: true });
            if (res.ok) setRoleAssignments(await res.json());
            else setRoleAssignments([]);
        } catch { setRoleAssignments([]); }
    };

    const fetchScopeResources = async () => {
        try {
            const [stacksRes, nodesRes] = await Promise.all([
                apiFetch('/stacks', { localOnly: true }),
                apiFetch('/nodes', { localOnly: true }),
            ]);
            if (stacksRes.ok) {
                const data = await stacksRes.json();
                setAvailableStacks(Array.isArray(data) ? data.filter((s: unknown): s is string => typeof s === 'string') : []);
            }
            if (nodesRes.ok) {
                const data = await nodesRes.json();
                setAvailableNodes(Array.isArray(data) ? data.map((n: { id: number; name: string }) => ({ id: n.id, name: n.name })) : []);
            }
        } catch { /* ignore */ }
    };

    const addRoleAssignment = async () => {
        if (!editingUser || !scopeResourceId) return;
        setAddingScope(true);
        try {
            const res = await apiFetch(`/users/${editingUser.id}/roles`, {
                method: 'POST',
                localOnly: true,
                body: JSON.stringify({ role: scopeRole, resource_type: scopeResourceType, resource_id: scopeResourceId }),
            });
            if (!res.ok) {
                const err = await res.json();
                toast.error(err?.error || err?.message || 'Failed to add scope.');
                return;
            }
            toast.success('Scope added.');
            setScopeResourceId('');
            fetchRoleAssignments(editingUser.id);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Something went wrong.';
            toast.error(msg);
        } finally { setAddingScope(false); }
    };

    const removeRoleAssignment = async (assignId: number) => {
        if (!editingUser) return;
        try {
            const res = await apiFetch(`/users/${editingUser.id}/roles/${assignId}`, { method: 'DELETE', localOnly: true });
            if (!res.ok) {
                const err = await res.json();
                toast.error(err?.error || err?.message || 'Failed to remove scope.');
                return;
            }
            toast.success('Scope removed.');
            fetchRoleAssignments(editingUser.id);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Something went wrong.';
            toast.error(msg);
        }
    };

    return (
        <ProGate featureName="User management">
            <div className="space-y-6">
                <div className="flex items-start justify-between pr-8">
                    <div>
                        <h3 className="text-lg font-medium tracking-tight">User Management</h3>
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
                    <div className="space-y-4 bg-glass border border-glass-border p-4 rounded-lg">
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
                                <Select value={formRole} onValueChange={(v) => setFormRole(v as UserRole)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="admin">Admin</SelectItem>
                                        <SelectItem value="viewer">Viewer</SelectItem>
                                        {isPro && license?.variant === 'team' && (
                                            <>
                                                <SelectItem value="deployer">Deployer</SelectItem>
                                                <SelectItem value="node-admin">Node Admin</SelectItem>
                                                <SelectItem value="auditor">Auditor</SelectItem>
                                            </>
                                        )}
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

                        {/* Scoped Permissions (Admiral, editing only) */}
                        {editingUser && isPro && license?.variant === 'team' && (
                            <div className="border border-glass-border rounded-lg p-4 space-y-3 mt-4">
                                <h4 className="text-sm font-medium">Scoped Permissions</h4>
                                <p className="text-xs text-muted-foreground">
                                    Grant additional permissions on specific stacks or nodes. These supplement the user's global role.
                                </p>

                                {roleAssignments.length > 0 && (
                                    <div className="space-y-1">
                                        {roleAssignments.map((a) => (
                                            <div key={a.id} className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-1.5">
                                                <span>
                                                    <Badge variant="outline" className="text-xs mr-2 capitalize">{a.role}</Badge>
                                                    on <span className="font-medium capitalize">{a.resource_type}</span>: <span className="font-mono text-xs">{a.resource_id}</span>
                                                </span>
                                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeRoleAssignment(a.id)}>
                                                    <Trash2 className="w-3 h-3 text-destructive" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-end gap-2">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Role</Label>
                                        <Select value={scopeRole} onValueChange={(v) => setScopeRole(v as UserRole)}>
                                            <SelectTrigger className="h-8 text-xs w-[120px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="deployer">Deployer</SelectItem>
                                                <SelectItem value="node-admin">Node Admin</SelectItem>
                                                <SelectItem value="admin">Admin</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Resource Type</Label>
                                        <Select value={scopeResourceType} onValueChange={(v) => { setScopeResourceType(v as 'stack' | 'node'); setScopeResourceId(''); fetchScopeResources(); }}>
                                            <SelectTrigger className="h-8 text-xs w-[100px]">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="stack">Stack</SelectItem>
                                                <SelectItem value="node">Node</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1 flex-1">
                                        <Label className="text-xs">Resource</Label>
                                        <Select value={scopeResourceId} onValueChange={setScopeResourceId}>
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue placeholder="Select..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {scopeResourceType === 'stack' ? (
                                                    availableStacks.map((s) => (
                                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                                    ))
                                                ) : (
                                                    availableNodes.map((n) => (
                                                        <SelectItem key={n.id} value={String(n.id)}>{n.name}</SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button size="sm" className="h-8" onClick={addRoleAssignment} disabled={addingScope || !scopeResourceId}>
                                        <Plus className="w-3 h-3 mr-1" />
                                        Add
                                    </Button>
                                </div>
                            </div>
                        )}
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
                    <div className="border border-glass-border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-muted/30 border-b border-glass-border">
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
                                        <tr key={u.id} className="border-b border-glass-border last:border-0 hover:bg-muted/10">
                                            <td className="px-4 py-2.5 font-medium">
                                                {u.username}
                                                {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                                            </td>
                                            <td className="px-4 py-2.5">
                                                <Badge variant={u.role === 'admin' ? 'default' : u.role === 'viewer' ? 'secondary' : 'outline'} className="text-xs capitalize">
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
