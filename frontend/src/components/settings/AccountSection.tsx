import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { TogglePill } from '@/components/ui/toggle-pill';
import { AlertTriangle, RefreshCw, Shield, ShieldCheck } from 'lucide-react';
import { MfaEnrollDialog } from '@/components/mfa/MfaEnrollDialog';
import { MfaDisableDialog } from '@/components/mfa/MfaDisableDialog';
import { MfaBackupCodesDialog } from '@/components/mfa/MfaBackupCodesDialog';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { SettingsSection } from './SettingsSection';
import { SettingsField } from './SettingsField';
import { SettingsCallout } from './SettingsCallout';
import { SettingsActions, SettingsPrimaryButton } from './SettingsActions';
import { useMastheadStats } from './MastheadStatsContext';

interface MfaStatus {
    enabled: boolean;
    backupCodesRemaining: number;
    sso_enforce_mfa: boolean;
}

interface SSOProvider {
    provider: string;
    type: 'ldap' | 'oidc';
}

export function AccountSection() {
    const [authData, setAuthData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
    const [isSaving, setIsSaving] = useState(false);

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

    const handlePasswordChange = async () => {
        if (!authData.oldPassword || !authData.newPassword || !authData.confirmPassword) {
            toast.error('All fields are required');
            return;
        }
        if (authData.newPassword !== authData.confirmPassword) {
            toast.error('New passwords do not match');
            return;
        }
        if (authData.newPassword.length < 8) {
            toast.error('New password must be at least 8 characters');
            return;
        }
        setIsSaving(true);
        try {
            const res = await apiFetch('/auth/password', {
                method: 'PUT',
                body: JSON.stringify({ oldPassword: authData.oldPassword, newPassword: authData.newPassword }),
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
            setIsSaving(false);
        }
    };

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

    const passwordStrengthHelper = useMemo(() => {
        const pwd = authData.newPassword;
        if (!pwd) return '12+ chars · mixed case · one number';
        if (pwd.length < 8) return 'Too short. At least 8 characters.';
        if (pwd.length < 12) return 'Acceptable. 12 or more recommended.';
        return 'Strong';
    }, [authData.newPassword]);

    const newPasswordTone = authData.newPassword
        ? authData.newPassword.length >= 12
            ? 'success'
            : authData.newPassword.length < 8
                ? 'error'
                : 'warn'
        : 'default';

    const confirmHelper = useMemo(() => {
        if (!authData.confirmPassword) return 'Re-enter the new password to confirm.';
        return authData.confirmPassword === authData.newPassword
            ? 'Match'
            : 'Does not match the new password';
    }, [authData.confirmPassword, authData.newPassword]);

    const confirmTone = authData.confirmPassword
        ? authData.confirmPassword === authData.newPassword
            ? 'success'
            : 'error'
        : 'default';

    useMastheadStats(
        mfaLoading
            ? null
            : [
                {
                    label: '2FA',
                    value: mfa?.enabled ? 'on' : 'off',
                    tone: mfa?.enabled ? 'value' : 'warn',
                },
                ...(mfa?.enabled && mfa.backupCodesRemaining <= 2
                    ? [{
                        label: 'BACKUP',
                        value: `${mfa.backupCodesRemaining} left`,
                        tone: mfa.backupCodesRemaining === 0 ? ('error' as const) : ('warn' as const),
                    }]
                    : []),
            ],
    );

    return (
        <div className="flex flex-col gap-10">
            <SettingsSection title="Password">
                <SettingsField
                    label="Current password"
                    helper="Required to change any auth setting on this account."
                    htmlFor="account-current-password"
                >
                    <Input
                        id="account-current-password"
                        type="password"
                        autoComplete="current-password"
                        value={authData.oldPassword}
                        onChange={(e) => setAuthData({ ...authData, oldPassword: e.target.value })}
                    />
                </SettingsField>
                <SettingsField
                    label="New password"
                    helper={passwordStrengthHelper}
                    tone={newPasswordTone}
                    htmlFor="account-new-password"
                >
                    <Input
                        id="account-new-password"
                        type="password"
                        autoComplete="new-password"
                        value={authData.newPassword}
                        onChange={(e) => setAuthData({ ...authData, newPassword: e.target.value })}
                    />
                </SettingsField>
                <SettingsField
                    label="Confirm new password"
                    helper={confirmHelper}
                    tone={confirmTone}
                    htmlFor="account-confirm-password"
                >
                    <Input
                        id="account-confirm-password"
                        type="password"
                        autoComplete="new-password"
                        value={authData.confirmPassword}
                        onChange={(e) => setAuthData({ ...authData, confirmPassword: e.target.value })}
                    />
                </SettingsField>
                <SettingsActions>
                    <SettingsPrimaryButton onClick={handlePasswordChange} disabled={isSaving}>
                        {isSaving ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Updating
                            </>
                        ) : (
                            'Update password'
                        )}
                    </SettingsPrimaryButton>
                </SettingsActions>
            </SettingsSection>

            <SettingsSection
                title="Two-factor authentication"
                kicker={mfa?.enabled ? 'enabled' : 'off'}
            >
                {mfaLoading ? (
                    <div className="py-4 text-xs text-stat-subtitle">Loading…</div>
                ) : mfa?.enabled ? (
                    <>
                        <SettingsField
                            label="Authenticator app"
                            helper="Sign-in requires a time-based code from your authenticator. Keep your backup codes safe."
                        >
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-brand" strokeWidth={1.5} />
                                <span className="font-mono text-[10px] leading-3 uppercase tracking-[0.18em] text-stat-value">
                                    enrolled
                                </span>
                            </div>
                        </SettingsField>

                        <SettingsField
                            label="Backup codes"
                            helper={
                                mfa.backupCodesRemaining === 0
                                    ? 'No backup codes remain. Regenerate a fresh set before you lose access to your authenticator.'
                                    : mfa.backupCodesRemaining <= 2
                                        ? 'Running low. Regenerate a fresh set.'
                                        : 'Single-use codes for when your authenticator is unavailable.'
                            }
                            tone={
                                mfa.backupCodesRemaining === 0
                                    ? 'error'
                                    : mfa.backupCodesRemaining <= 2
                                        ? 'warn'
                                        : 'default'
                            }
                        >
                            <div className="flex items-center gap-3">
                                <span className="font-mono tabular-nums text-sm text-stat-value">
                                    {mfa.backupCodesRemaining} remaining
                                </span>
                                <Button variant="outline" size="sm" onClick={() => setRegenOpen(true)}>
                                    Regenerate
                                </Button>
                            </div>
                        </SettingsField>

                        {hasSso ? (
                            <SettingsField
                                label="Require 2FA on SSO sign-in"
                                helper="By default, SSO logins skip the second factor. Enforce it here to require both."
                            >
                                <TogglePill
                                    checked={mfa.sso_enforce_mfa}
                                    onChange={handleBypassToggle}
                                    disabled={togglingBypass}
                                />
                            </SettingsField>
                        ) : null}

                        <SettingsActions>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive/80 hover:bg-destructive hover:text-destructive-foreground"
                                onClick={() => setDisableOpen(true)}
                            >
                                Disable 2FA
                            </Button>
                        </SettingsActions>
                    </>
                ) : (
                    <div className="pt-3">
                        <SettingsCallout
                            tone="warn"
                            icon={<Shield className="h-4 w-4" strokeWidth={1.5} />}
                            title="Two-factor is off"
                            subtitle="Add a time-based code from your authenticator app, every sign-in."
                            action={
                                <SettingsPrimaryButton size="sm" onClick={() => setEnrollOpen(true)}>
                                    Set up 2FA
                                </SettingsPrimaryButton>
                            }
                        />
                    </div>
                )}

                {mfa?.enabled && mfa.backupCodesRemaining === 0 ? (
                    <div className="pt-3">
                        <SettingsCallout
                            tone="error"
                            icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.5} />}
                            title="No backup codes left"
                            subtitle="Without codes, recovery needs an administrator if you lose your authenticator."
                            action={
                                <Button variant="outline" size="sm" onClick={() => setRegenOpen(true)}>
                                    Regenerate
                                </Button>
                            }
                        />
                    </div>
                ) : null}
            </SettingsSection>

            <MfaEnrollDialog open={enrollOpen} onOpenChange={setEnrollOpen} onEnrolled={refreshMfa} />
            <MfaDisableDialog open={disableOpen} onOpenChange={setDisableOpen} onDisabled={refreshMfa} />
            <MfaBackupCodesDialog open={regenOpen} onOpenChange={setRegenOpen} onRegenerated={refreshMfa} />
        </div>
    );
}
