import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { AdmiralGate } from './AdmiralGate';
import { TierBadge } from './TierBadge';
import { Shield, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface SSOProviderConfig {
    provider: string;
    enabled: boolean;
    displayName: string;
    // LDAP
    ldapUrl?: string;
    ldapBindDn?: string;
    ldapBindPassword?: string;
    ldapSearchBase?: string;
    ldapSearchFilter?: string;
    ldapAdminGroupDn?: string;
    ldapDefaultRole?: string;
    ldapTlsRejectUnauthorized?: boolean;
    // OIDC
    oidcIssuerUrl?: string;
    oidcClientId?: string;
    oidcClientSecret?: string;
    oidcScopes?: string;
    oidcAdminClaim?: string;
    oidcAdminClaimValue?: string;
    oidcDefaultRole?: string;
}

const PROVIDERS = [
    { id: 'ldap', label: 'LDAP / Active Directory', type: 'ldap' as const },
    { id: 'oidc_google', label: 'Google', type: 'oidc' as const },
    { id: 'oidc_github', label: 'GitHub', type: 'oidc' as const },
    { id: 'oidc_okta', label: 'Okta', type: 'oidc' as const },
];

function ProviderCard({ providerId, type, label, initialConfig, onSave }: {
    providerId: string;
    type: 'ldap' | 'oidc';
    label: string;
    initialConfig: SSOProviderConfig | null;
    onSave: () => void;
}) {
    const [config, setConfig] = useState<Partial<SSOProviderConfig>>(initialConfig || { enabled: false });
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
    const [expanded, setExpanded] = useState(!!initialConfig?.enabled);

    const update = (field: string, value: string | boolean) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const body = {
                ...config,
                provider: providerId,
                displayName: config.displayName || label,
            };
            const res = await apiFetch(`/sso/config/${providerId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                toast.success('SSO configuration saved');
                onSave();
            } else {
                const data = await res.json();
                toast.error(data?.error || data?.message || 'Failed to save');
            }
        } catch (error: unknown) {
            toast.error((error as Error)?.message || 'Failed to save SSO configuration');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await apiFetch(`/sso/config/${providerId}/test`, { method: 'POST' });
            const data = await res.json();
            setTestResult(data);
            if (data.success) {
                toast.success('Connection successful');
            } else {
                toast.error(data.error || 'Connection failed');
            }
        } catch {
            setTestResult({ success: false, error: 'Connection test failed' });
        } finally {
            setTesting(false);
        }
    };

    const handleDelete = async () => {
        try {
            const res = await apiFetch(`/sso/config/${providerId}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('SSO provider removed');
                setConfig({ enabled: false });
                setExpanded(false);
                onSave();
            }
        } catch {
            toast.error('Failed to remove provider');
        }
    };

    return (
        <div className="border border-border rounded-lg">
            <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-3">
                    <span className="font-medium text-sm">{label}</span>
                    {initialConfig?.enabled && (
                        <Badge variant="secondary" className="text-xs bg-success-muted text-success border-success/20">
                            Active
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        checked={!!config.enabled}
                        onCheckedChange={(checked) => update('enabled', checked)}
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            </div>

            {expanded && (
                <div className="border-t border-border p-4 space-y-4">
                    {type === 'ldap' ? (
                        <>
                            <div className="grid gap-2">
                                <Label className="text-xs text-muted-foreground">Server URL</Label>
                                <Input
                                    placeholder="ldap://ldap.example.com:389"
                                    value={config.ldapUrl || ''}
                                    onChange={e => update('ldapUrl', e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="grid gap-2">
                                    <Label className="text-xs text-muted-foreground">Bind DN</Label>
                                    <Input
                                        placeholder="cn=readonly,dc=example,dc=com"
                                        value={config.ldapBindDn || ''}
                                        onChange={e => update('ldapBindDn', e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="text-xs text-muted-foreground">Bind Password</Label>
                                    <Input
                                        type="password"
                                        placeholder="Enter to update"
                                        value={config.ldapBindPassword || ''}
                                        onChange={e => update('ldapBindPassword', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label className="text-xs text-muted-foreground">Search Base</Label>
                                <Input
                                    placeholder="ou=users,dc=example,dc=com"
                                    value={config.ldapSearchBase || ''}
                                    onChange={e => update('ldapSearchBase', e.target.value)}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label className="text-xs text-muted-foreground">Search Filter</Label>
                                <Input
                                    placeholder="(uid={{username}})"
                                    value={config.ldapSearchFilter || ''}
                                    onChange={e => update('ldapSearchFilter', e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Use <code className="bg-muted px-1 rounded">{'{{username}}'}</code> as placeholder.
                                    For Active Directory: <code className="bg-muted px-1 rounded">{'(sAMAccountName={{username}})'}</code>
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="grid gap-2">
                                    <Label className="text-xs text-muted-foreground">Admin Group DN</Label>
                                    <Input
                                        placeholder="cn=sencho-admins,ou=groups,dc=..."
                                        value={config.ldapAdminGroupDn || ''}
                                        onChange={e => update('ldapAdminGroupDn', e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="text-xs text-muted-foreground">Default Role</Label>
                                    <Select
                                        value={config.ldapDefaultRole || 'viewer'}
                                        onValueChange={v => update('ldapDefaultRole', v)}
                                    >
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="viewer">Viewer</SelectItem>
                                            <SelectItem value="admin">Admin</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={config.ldapTlsRejectUnauthorized !== false}
                                    onCheckedChange={checked => update('ldapTlsRejectUnauthorized', checked)}
                                />
                                <Label className="text-xs text-muted-foreground">Verify TLS certificate</Label>
                            </div>
                        </>
                    ) : (
                        <>
                            {providerId === 'oidc_okta' && (
                                <div className="grid gap-2">
                                    <Label className="text-xs text-muted-foreground">Issuer URL</Label>
                                    <Input
                                        placeholder="https://dev-123456.okta.com"
                                        value={config.oidcIssuerUrl || ''}
                                        onChange={e => update('oidcIssuerUrl', e.target.value)}
                                    />
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="grid gap-2">
                                    <Label className="text-xs text-muted-foreground">Client ID</Label>
                                    <Input
                                        placeholder="Client ID"
                                        value={config.oidcClientId || ''}
                                        onChange={e => update('oidcClientId', e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="text-xs text-muted-foreground">Client Secret</Label>
                                    <Input
                                        type="password"
                                        placeholder="Enter to update"
                                        value={config.oidcClientSecret || ''}
                                        onChange={e => update('oidcClientSecret', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="grid gap-2">
                                    <Label className="text-xs text-muted-foreground">Admin Claim</Label>
                                    <Input
                                        placeholder="groups"
                                        value={config.oidcAdminClaim || ''}
                                        onChange={e => update('oidcAdminClaim', e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="text-xs text-muted-foreground">Admin Claim Value</Label>
                                    <Input
                                        placeholder="sencho-admins"
                                        value={config.oidcAdminClaimValue || ''}
                                        onChange={e => update('oidcAdminClaimValue', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="grid gap-2">
                                <Label className="text-xs text-muted-foreground">Default Role</Label>
                                <Select
                                    value={config.oidcDefaultRole || 'viewer'}
                                    onValueChange={v => update('oidcDefaultRole', v)}
                                >
                                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="viewer">Viewer</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </>
                    )}

                    <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-2">
                            <Button size="sm" onClick={handleSave} disabled={saving}>
                                {saving ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Saving...</> : 'Save'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
                                {testing ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Testing...</> : 'Test Connection'}
                            </Button>
                            {testResult && (
                                testResult.success
                                    ? <CheckCircle className="w-4 h-4 text-success" />
                                    : <XCircle className="w-4 h-4 text-red-500" />
                            )}
                        </div>
                        {initialConfig && (
                            <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-400" onClick={handleDelete}>
                                Remove
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export function SSOSection() {
    const [configs, setConfigs] = useState<SSOProviderConfig[]>([]);

    const fetchConfigs = async () => {
        try {
            const res = await apiFetch('/sso/config');
            if (res.ok) setConfigs(await res.json());
        } catch { /* ignore - AdmiralGate will handle non-pro */ }
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { fetchConfigs(); }, []);

    const getConfig = (provider: string) => configs.find(c => c.provider === provider) || null;

    return (
        <AdmiralGate featureName="SSO Authentication">
            <div className="space-y-6">
                <div>
                    <h3 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                        <Shield className="w-5 h-5" />
                        SSO Authentication <TierBadge />
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Connect your identity provider so team members can sign in with their existing credentials.
                        SSO works alongside password authentication - it does not replace it.
                    </p>
                </div>

                <div className="space-y-3">
                    {PROVIDERS.map(p => (
                        <ProviderCard
                            key={p.id}
                            providerId={p.id}
                            type={p.type}
                            label={p.label}
                            initialConfig={getConfig(p.id)}
                            onSave={fetchConfigs}
                        />
                    ))}
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                    <p>SSO users are automatically provisioned on first login and assigned a role based on your identity provider's group membership.</p>
                    <p>For OIDC providers, set the OAuth callback URL to: <code className="bg-muted px-1 rounded">{'https://<your-sencho-url>/api/auth/sso/oidc/<provider>/callback'}</code></p>
                </div>
            </div>
        </AdmiralGate>
    );
}
