import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { TogglePill } from '@/components/ui/toggle-pill';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, RefreshCw, Shield, ShieldCheck } from 'lucide-react';
import { MfaEnrollDialog } from '@/components/mfa/MfaEnrollDialog';
import { MfaDisableDialog } from '@/components/mfa/MfaDisableDialog';
import { MfaBackupCodesDialog } from '@/components/mfa/MfaBackupCodesDialog';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';

interface AccountSectionProps {
    authData: { oldPassword: string; newPassword: string; confirmPassword: string };
    onAuthDataChange: (data: { oldPassword: string; newPassword: string; confirmPassword: string }) => void;
    onPasswordChange: () => Promise<void>;
    isSaving: boolean;
}

interface MfaStatus {
    enabled: boolean;
    backupCodesRemaining: number;
    sso_enforce_mfa: boolean;
}

interface SSOProvider {
    provider: string;
    type: 'ldap' | 'oidc';
}

export function AccountSection({ authData, onAuthDataChange, onPasswordChange, isSaving }: AccountSectionProps) {
    const [mfa, setMfa] = useState<MfaStatus | null>(null);
    const [mfaLoading, setMfaLoading] = useState(true);
    const [hasSso, setHasSso] = useState(false);
    const [enrollOpen, setEnrollOpen] = useState(false);
    const [disableOpen, setDisableOpen] = useState(false);
    const [regenOpen, setRegenOpen] = useState(false);
    const [togglingBypass, setTogglingBypass] = useState(false);

    const refreshMfa = useCallback(async () => {
        setMfaLoading(true);
        try {
            const res = await apiFetch('/auth/mfa/status', { localOnly: true });
            if (res.ok) setMfa(await res.json());
        } catch {
            // Non-fatal; surface as disabled card.
        } finally {
            setMfaLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshMfa();
        apiFetch('/auth/sso/providers', { localOnly: true })
            .then((r) => (r.ok ? r.json() : []))
            .then((providers: SSOProvider[]) => setHasSso(providers.length > 0))
            .catch(() => setHasSso(false));
    }, [refreshMfa]);

    const handleBypassToggle = async (enforce: boolean) => {
        setTogglingBypass(true);
        try {
            const res = await apiFetch('/auth/mfa/sso-bypass', {
                method: 'PUT',
                localOnly: true,
                body: JSON.stringify({ enforce }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(data?.error || data?.message || 'Could not update SSO preference');
                return;
            }
            setMfa((prev) => (prev ? { ...prev, sso_enforce_mfa: enforce } : prev));
        } catch (err) {
            const e = err as { message?: string; error?: string } | undefined;
            toast.error(e?.message || e?.error || 'Could not update SSO preference');
        } finally {
            setTogglingBypass(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="space-y-4 max-w-sm">
                <div className="space-y-2">
                    <Label>Current Password</Label>
                    <Input
                        type="password"
                        value={authData.oldPassword}
                        onChange={(e) => onAuthDataChange({ ...authData, oldPassword: e.target.value })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>New Password</Label>
                    <Input
                        type="password"
                        value={authData.newPassword}
                        onChange={(e) => onAuthDataChange({ ...authData, newPassword: e.target.value })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Confirm New Password</Label>
                    <Input
                        type="password"
                        value={authData.confirmPassword}
                        onChange={(e) => onAuthDataChange({ ...authData, confirmPassword: e.target.value })}
                    />
                </div>
                <Button onClick={onPasswordChange} disabled={isSaving} className="w-full">
                    {isSaving
                        ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Updating...</>
                        : 'Update Password'
                    }
                </Button>
            </div>

            <Separator />

            {/* Two-factor authentication card */}
            <div className="rounded-lg border border-card-border border-t-card-border-top bg-card shadow-card-bevel p-5 max-w-lg">
                <div className="flex items-start gap-3">
                    {mfa?.enabled
                        ? <ShieldCheck className="w-5 h-5 mt-0.5 text-success" strokeWidth={1.5} />
                        : <Shield className="w-5 h-5 mt-0.5 text-muted-foreground" strokeWidth={1.5} />
                    }
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium">Two-factor authentication</h4>
                            {mfa?.enabled && <Badge variant="secondary">Enabled</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                            {mfa?.enabled
                                ? 'Sign-in requires a code from your authenticator app. Back up your codes somewhere safe.'
                                : 'Add a time-based one-time password to your account for an extra layer of security.'}
                        </p>

                        {mfaLoading ? (
                            <div className="mt-4 text-xs text-muted-foreground">Loading…</div>
                        ) : mfa?.enabled ? (
                            <div className="mt-4 space-y-3">
                                {mfa.backupCodesRemaining === 0 ? (
                                    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" strokeWidth={1.5} />
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-destructive">No backup codes left</div>
                                            <div className="text-xs text-destructive/80 mt-0.5">
                                                Regenerate a new set before you lose access to your authenticator app. Without codes, recovery needs an administrator.
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="mt-2 h-7 px-2 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                                onClick={() => setRegenOpen(true)}
                                            >
                                                Regenerate now
                                            </Button>
                                        </div>
                                    </div>
                                ) : mfa.backupCodesRemaining <= 2 ? (
                                    <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-warning">
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
                                        <span>
                                            {mfa.backupCodesRemaining} backup code{mfa.backupCodesRemaining === 1 ? '' : 's'} remaining, regenerate a fresh set
                                        </span>
                                    </div>
                                ) : (
                                    <div className="text-xs text-muted-foreground font-mono tabular-nums">
                                        {mfa.backupCodesRemaining} backup codes remaining
                                    </div>
                                )}

                                {hasSso && (
                                    <div className="flex items-start justify-between gap-3 rounded-md border border-card-border bg-background/40 p-3">
                                        <div>
                                            <div className="text-sm">Require 2FA even when signing in via SSO</div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                SSO logins skip the second factor by default.
                                            </div>
                                        </div>
                                        <TogglePill
                                            checked={mfa.sso_enforce_mfa}
                                            onChange={handleBypassToggle}
                                            disabled={togglingBypass}
                                        />
                                    </div>
                                )}

                                <div className="flex flex-wrap gap-2">
                                    <Button variant="ghost" size="sm" onClick={() => setRegenOpen(true)}>
                                        Regenerate backup codes
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive/60 hover:bg-destructive hover:text-destructive-foreground"
                                        onClick={() => setDisableOpen(true)}
                                    >
                                        Disable 2FA
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4">
                                <Button size="sm" onClick={() => setEnrollOpen(true)}>
                                    Set up 2FA
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <MfaEnrollDialog open={enrollOpen} onOpenChange={setEnrollOpen} onEnrolled={refreshMfa} />
            <MfaDisableDialog open={disableOpen} onOpenChange={setDisableOpen} onDisabled={refreshMfa} />
            <MfaBackupCodesDialog open={regenOpen} onOpenChange={setRegenOpen} onRegenerated={refreshMfa} />
        </div>
    );
}
