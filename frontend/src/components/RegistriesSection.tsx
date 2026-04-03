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
import { Database, Plus, Trash2, Pencil, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';

type RegistryType = 'dockerhub' | 'ghcr' | 'ecr' | 'custom';

interface RegistryItem {
    id: number;
    name: string;
    url: string;
    type: RegistryType;
    username: string;
    has_secret: boolean;
    aws_region: string | null;
    created_at: number;
    updated_at: number;
}

const TYPE_LABELS: Record<RegistryType, string> = {
    dockerhub: 'Docker Hub',
    ghcr: 'GitHub (GHCR)',
    ecr: 'AWS ECR',
    custom: 'Custom',
};

const TYPE_BADGE_VARIANT: Record<RegistryType, 'default' | 'secondary' | 'outline'> = {
    dockerhub: 'default',
    ghcr: 'secondary',
    ecr: 'secondary',
    custom: 'outline',
};

const TYPE_URL_DEFAULTS: Record<RegistryType, string> = {
    dockerhub: 'https://index.docker.io/v1/',
    ghcr: 'ghcr.io',
    ecr: '',
    custom: '',
};

const TYPE_USERNAME_HINT: Record<RegistryType, string> = {
    dockerhub: 'Docker Hub username',
    ghcr: 'GitHub username',
    ecr: 'AWS Access Key ID',
    custom: 'Username',
};

const TYPE_SECRET_HINT: Record<RegistryType, string> = {
    dockerhub: 'Access token or password',
    ghcr: 'Personal access token (PAT)',
    ecr: 'AWS Secret Access Key',
    custom: 'Password or token',
};

function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function RegistriesSection() {
    const [registries, setRegistries] = useState<RegistryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [testingId, setTestingId] = useState<number | null>(null);

    const [formName, setFormName] = useState('');
    const [formUrl, setFormUrl] = useState('');
    const [formType, setFormType] = useState<RegistryType>('dockerhub');
    const [formUsername, setFormUsername] = useState('');
    const [formSecret, setFormSecret] = useState('');
    const [formAwsRegion, setFormAwsRegion] = useState('');

    const fetchRegistries = async () => {
        try {
            const res = await apiFetch('/registries', { localOnly: true });
            if (res.ok) {
                setRegistries(await res.json());
            }
        } catch {
            toast.error('Failed to load registries.');
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchRegistries(); }, []);

    const resetForm = () => {
        setFormName('');
        setFormUrl('');
        setFormType('dockerhub');
        setFormUsername('');
        setFormSecret('');
        setFormAwsRegion('');
        setEditingId(null);
        setShowForm(false);
    };

    const handleTypeChange = (type: RegistryType) => {
        setFormType(type);
        if (!editingId) {
            setFormUrl(TYPE_URL_DEFAULTS[type]);
        }
    };

    const startEdit = (reg: RegistryItem) => {
        setEditingId(reg.id);
        setFormName(reg.name);
        setFormUrl(reg.url);
        setFormType(reg.type);
        setFormUsername(reg.username);
        setFormSecret('');
        setFormAwsRegion(reg.aws_region ?? '');
        setShowForm(true);
    };

    const handleSave = async () => {
        if (!formName.trim()) { toast.error('Name is required.'); return; }
        if (!formUrl.trim()) { toast.error('URL is required.'); return; }
        if (!formUsername.trim()) { toast.error('Username is required.'); return; }
        if (!editingId && !formSecret.trim()) { toast.error('Secret/token is required.'); return; }
        if (formType === 'ecr' && !formAwsRegion.trim()) { toast.error('AWS region is required for ECR.'); return; }

        setSaving(true);
        try {
            const body: Record<string, unknown> = {
                name: formName.trim(),
                url: formUrl.trim(),
                type: formType,
                username: formUsername.trim(),
                aws_region: formType === 'ecr' ? formAwsRegion.trim() : null,
            };
            if (formSecret.trim()) body.secret = formSecret.trim();

            const url = editingId ? `/registries/${editingId}` : '/registries';
            const method = editingId ? 'PUT' : 'POST';

            const res = await apiFetch(url, {
                method,
                localOnly: true,
                body: JSON.stringify(body),
            });

            if (res.ok) {
                toast.success(editingId ? 'Registry updated.' : 'Registry added.');
                resetForm();
                fetchRegistries();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to save registry.');
            }
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Network error.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            const res = await apiFetch(`/registries/${id}`, { method: 'DELETE', localOnly: true });
            if (res.ok) {
                toast.success('Registry deleted.');
                fetchRegistries();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to delete registry.');
            }
        } catch {
            toast.error('Network error.');
        }
    };

    const handleTest = async (id: number) => {
        setTestingId(id);
        try {
            const res = await apiFetch(`/registries/${id}/test`, { method: 'POST', localOnly: true });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    toast.success('Connection successful!');
                } else {
                    toast.error(data.error || 'Connection failed.');
                }
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Test failed.');
            }
        } catch {
            toast.error('Network error.');
        } finally {
            setTestingId(null);
        }
    };

    return (
        <AdmiralGate featureName="Private Registry Management">
          <CapabilityGate capability="registries" featureName="Private Registries">
            <div className="space-y-6">
                <div className="flex items-start justify-between pr-8">
                    <div>
                        <h3 className="text-lg font-medium tracking-tight flex items-center gap-2">
                            Private Registries <TierBadge />
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Store credentials for private Docker registries. Sencho injects them automatically during deploy and pull operations.
                        </p>
                    </div>
                    <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }}>
                        <Plus className="w-4 h-4 mr-1.5" /> Add Registry
                    </Button>
                </div>

                {/* Create / Edit form */}
                {showForm && (
                    <div className="space-y-4 bg-muted/10 p-4 border border-border rounded-xl">
                        <div className="space-y-2">
                            <Label>Registry Type</Label>
                            <Select value={formType} onValueChange={(v) => handleTypeChange(v as RegistryType)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="dockerhub">Docker Hub</SelectItem>
                                    <SelectItem value="ghcr">GitHub Container Registry (GHCR)</SelectItem>
                                    <SelectItem value="ecr">AWS Elastic Container Registry (ECR)</SelectItem>
                                    <SelectItem value="custom">Custom / Self-hosted</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input
                                placeholder="My private registry"
                                value={formName}
                                onChange={e => setFormName(e.target.value)}
                                maxLength={100}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Registry URL</Label>
                            <Input
                                placeholder={formType === 'ecr' ? '123456789.dkr.ecr.us-east-1.amazonaws.com' : 'registry.example.com'}
                                value={formUrl}
                                onChange={e => setFormUrl(e.target.value)}
                                maxLength={500}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>{formType === 'ecr' ? 'AWS Access Key ID' : 'Username'}</Label>
                                <Input
                                    placeholder={TYPE_USERNAME_HINT[formType]}
                                    value={formUsername}
                                    onChange={e => setFormUsername(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>{formType === 'ecr' ? 'AWS Secret Access Key' : 'Secret / Token'}</Label>
                                <Input
                                    type="password"
                                    placeholder={editingId ? '(leave blank to keep current)' : TYPE_SECRET_HINT[formType]}
                                    value={formSecret}
                                    onChange={e => setFormSecret(e.target.value)}
                                />
                            </div>
                        </div>
                        {formType === 'ecr' && (
                            <div className="space-y-2">
                                <Label>AWS Region</Label>
                                <Input
                                    placeholder="us-east-1"
                                    value={formAwsRegion}
                                    onChange={e => setFormAwsRegion(e.target.value)}
                                />
                            </div>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
                            <Button size="sm" onClick={handleSave} disabled={saving}>
                                {saving ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />Saving...</> : editingId ? 'Update' : 'Add'}
                            </Button>
                        </div>
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
                {!loading && registries.length === 0 && !showForm && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Database className="w-10 h-10 text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">No private registries configured.</p>
                        <p className="text-xs text-muted-foreground mt-1">Add one to pull images from Docker Hub orgs, GHCR, ECR, or self-hosted registries.</p>
                    </div>
                )}

                {/* Registry list */}
                {!loading && registries.map(reg => (
                    <div key={reg.id} className="border border-border rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                                <Database className="w-4 h-4 text-muted-foreground shrink-0" />
                                <span className="font-medium text-sm truncate">{reg.name}</span>
                                <Badge variant={TYPE_BADGE_VARIANT[reg.type]} className="text-[10px] shrink-0">
                                    {TYPE_LABELS[reg.type]}
                                </Badge>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleTest(reg.id)}
                                    disabled={testingId === reg.id}
                                    title="Test connection"
                                >
                                    {testingId === reg.id ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <CheckCircle className="w-4 h-4" />
                                    )}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => startEdit(reg)} title="Edit">
                                    <Pencil className="w-4 h-4" />
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" title="Delete">
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Delete registry?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Deleting <strong>{reg.name}</strong> will remove its stored credentials. Stacks using images from this registry will fail to pull until credentials are re-added.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDelete(reg.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                Delete
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="font-mono truncate max-w-[200px]" title={reg.url}>{reg.url}</span>
                            <span>{reg.username}</span>
                            <span className="flex items-center gap-1">
                                {reg.has_secret ? (
                                    <><CheckCircle className="w-3 h-3 text-success" /> Secret stored</>
                                ) : (
                                    <><XCircle className="w-3 h-3 text-destructive" /> No secret</>
                                )}
                            </span>
                            {reg.aws_region && <span>Region: {reg.aws_region}</span>}
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDate(reg.created_at)}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
          </CapabilityGate>
        </AdmiralGate>
    );
}
