import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast-store';
import { useLicense } from '@/context/LicenseContext';
import { TierBadge } from '@/components/TierBadge';
import {
    Crown, CheckCircle, Check, XCircle, Clock, ExternalLink,
    CreditCard, RefreshCw, Zap, Compass, ShipWheel, Loader2,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { SettingsSection } from './SettingsSection';
import { SettingsField } from './SettingsField';
import { SettingsCallout } from './SettingsCallout';
import { SettingsActions, SettingsPrimaryButton } from './SettingsActions';
import { useMastheadStats } from './MastheadStatsContext';

// Lemon Squeezy hosted checkout URLs. Admiral monthly and annual include a built-in
// 14-day trial (email + card required on LS checkout); users receive a license key
// by email and paste it into the activate input below.
const SKIPPER_CHECKOUT_URL = 'https://saelix.lemonsqueezy.com/checkout/buy/f75bfb65-443a-46a0-abb1-981e0ff4b382';
const ADMIRAL_MONTHLY_CHECKOUT_URL = 'https://saelix.lemonsqueezy.com/checkout/buy/b049b824-176a-408d-a9d3-9365c979a61f';
const ADMIRAL_ANNUAL_CHECKOUT_URL = 'https://saelix.lemonsqueezy.com/checkout/buy/3e595568-92d3-4edd-90f1-25650248dfa9';

function getTierDisplayName(tier?: string, variant?: string | null, status?: string): string {
    if (tier === 'paid' && variant === 'admiral' && status === 'active') return 'Sencho Admiral';
    if (tier === 'paid' && variant === 'admiral' && status === 'trial') return 'Sencho Admiral (Trial)';
    if (tier === 'paid') return 'Sencho Skipper';
    return 'Sencho Community';
}

function getTierMastheadValue(tier?: string, variant?: string | null): string {
    if (tier === 'paid' && variant === 'admiral') return 'admiral';
    if (tier === 'paid') return 'skipper';
    return 'community';
}

export function LicenseSection() {
    const { license, isPaid, activate, deactivate } = useLicense();
    const [licenseKeyInput, setLicenseKeyInput] = useState('');
    const [isActivating, setIsActivating] = useState(false);
    const [isDeactivating, setIsDeactivating] = useState(false);
    const [billingLoading, setBillingLoading] = useState(false);

    const openBillingPortal = async () => {
        setBillingLoading(true);
        try {
            const res = await apiFetch('/license/billing-portal', { localOnly: true });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.url) {
                window.open(data.url, '_blank');
                return;
            }
            toast.error(data?.error || data?.message || data?.data?.error || 'Something went wrong.');
        } catch {
            toast.error('Failed to open billing portal.');
        } finally {
            setBillingLoading(false);
        }
    };

    const isAdmiral = isPaid && license?.variant === 'admiral' && license?.status === 'active';
    const showSkipperCard = !isPaid || license?.status === 'trial';
    const showTrialCta = license?.status !== 'active' && license?.status !== 'trial';
    const showAdmiralUpgradeCard = !isAdmiral && !showTrialCta;
    const showUpgradeCards = showSkipperCard || showAdmiralUpgradeCard;

    const renewsValue = useMemo(() => {
        if (!license) return null;
        if (license.isLifetime) return 'lifetime';
        if (license.validUntil) return new Date(license.validUntil).toLocaleDateString();
        return null;
    }, [license]);

    useMastheadStats([
        {
            label: 'PLAN',
            value: getTierMastheadValue(license?.tier, license?.variant),
            tone: isPaid ? 'value' : 'subtitle',
        },
        ...(license?.status === 'trial' && license.trialDaysRemaining !== null
            ? [{
                label: 'TRIAL',
                value: `${license.trialDaysRemaining}d left`,
                tone: 'warn' as const,
            }]
            : []),
        ...(license?.status === 'active' && renewsValue
            ? [{ label: license.isLifetime ? 'DURATION' : 'RENEWS', value: renewsValue }]
            : []),
        ...(license?.status === 'expired'
            ? [{ label: 'STATUS', value: 'expired', tone: 'error' as const }]
            : []),
    ]);

    const tierIcon = isPaid ? <CheckCircle className="h-4 w-4" /> : <Crown className="h-4 w-4" />;

    return (
        <div className="flex flex-col gap-10">
            <SettingsSection title="Plan">
                <SettingsField
                    label={getTierDisplayName(license?.tier, license?.variant, license?.status)}
                    helper={
                        license?.status === 'expired'
                            ? 'Your license has expired. Renew to restore paid features.'
                            : license?.status === 'disabled'
                                ? 'Your license has been disabled. Contact support for assistance.'
                                : license?.status === 'trial' && license.trialDaysRemaining !== null
                                    ? `Trial: ${license.trialDaysRemaining} day${license.trialDaysRemaining !== 1 ? 's' : ''} remaining.`
                                    : isPaid
                                        ? 'Active license on this control plane.'
                                        : 'Free tier with the core experience.'
                    }
                    tone={
                        license?.status === 'expired' || license?.status === 'disabled'
                            ? 'error'
                            : license?.status === 'trial'
                                ? 'warn'
                                : 'default'
                    }
                >
                    <div className="flex items-center gap-2">
                        <span className="text-stat-subtitle">{tierIcon}</span>
                        <TierBadge />
                    </div>
                </SettingsField>

                {license?.status === 'active' && license.customerName ? (
                    <SettingsField label="Customer">
                        <span className="text-sm text-stat-value">{license.customerName}</span>
                    </SettingsField>
                ) : null}

                {license?.status === 'active' && license.productName ? (
                    <SettingsField label="Product">
                        <span className="text-sm text-stat-value">{license.productName}</span>
                    </SettingsField>
                ) : null}

                {license?.status === 'active' && license.maskedKey ? (
                    <SettingsField label="License key">
                        <span className="font-mono text-xs text-stat-value">{license.maskedKey}</span>
                    </SettingsField>
                ) : null}

                {license?.status === 'expired' ? (
                    <SettingsField
                        label="Status"
                        helper="Renew to restore paid features."
                        tone="error"
                    >
                        <div className="flex items-center gap-2 text-destructive">
                            <XCircle className="h-4 w-4" />
                            <span className="text-sm">Expired</span>
                        </div>
                    </SettingsField>
                ) : null}

                {license?.status === 'trial' && license.trialDaysRemaining !== null ? (
                    <SettingsField
                        label="Trial countdown"
                        helper="Activate before the trial ends to keep paid features."
                        tone="warn"
                    >
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-warning" />
                            <span className="font-mono tabular-nums text-sm text-stat-value">
                                {license.trialDaysRemaining} day{license.trialDaysRemaining !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </SettingsField>
                ) : null}

                {license?.status === 'active' ? (
                    <SettingsActions align="between" hint="Lemon Squeezy manages billing">
                        <div className="flex items-center gap-2">
                            {!license.isLifetime && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={openBillingPortal}
                                    disabled={billingLoading}
                                >
                                    {billingLoading ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <CreditCard className="w-4 h-4" />
                                    )}
                                    Manage subscription
                                    <ExternalLink className="w-3 h-3 opacity-50" />
                                </Button>
                            )}
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
                                {isDeactivating ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        Deactivating
                                    </>
                                ) : (
                                    'Deactivate'
                                )}
                            </Button>
                        </div>
                    </SettingsActions>
                ) : null}
            </SettingsSection>

            {showTrialCta ? (
                <SettingsSection title="Try Admiral free">
                    <div className="pt-3 flex flex-col gap-3">
                        <SettingsCallout
                            tone="brand"
                            icon={<ShipWheel className="h-4 w-4" strokeWidth={1.5} />}
                            title="14 days, full Admiral"
                            subtitle="Host Console, Scheduled Operations, LDAP / Active Directory, audit log, API tokens, and unlimited accounts. Lemon Squeezy needs a card; cancel any time before day 14."
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <SettingsPrimaryButton
                                size="sm"
                                onClick={() => window.open(ADMIRAL_MONTHLY_CHECKOUT_URL, '_blank')}
                            >
                                Start monthly trial
                                <ExternalLink className="w-3 h-3 opacity-60" />
                            </SettingsPrimaryButton>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(ADMIRAL_ANNUAL_CHECKOUT_URL, '_blank')}
                            >
                                Start annual trial
                                <ExternalLink className="w-3 h-3 opacity-60" />
                            </Button>
                        </div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle/70">
                            ⓘ paste the license key from your email into the activate field below
                        </p>
                    </div>
                </SettingsSection>
            ) : null}

            {showUpgradeCards ? (
                <SettingsSection title="Upgrade">
                    <div className={`pt-3 grid gap-3 ${showSkipperCard && showAdmiralUpgradeCard ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                        {showSkipperCard ? (
                            <UpgradeCard
                                tone="warn"
                                icon={<Compass className="h-4 w-4" />}
                                title="Skipper"
                                blurb="Professional tools for solo operators."
                                features={[
                                    'Fleet View with drill-down',
                                    'Viewer accounts (1 admin + 3 viewers)',
                                    'Webhooks & stack labels',
                                    'Atomic deployments & backups',
                                    'Auto-update policies',
                                    'Google / GitHub / Okta SSO',
                                ]}
                                action={
                                    <SettingsPrimaryButton
                                        size="sm"
                                        className="w-full"
                                        onClick={() => window.open(SKIPPER_CHECKOUT_URL, '_blank')}
                                    >
                                        <Zap className="w-4 h-4" />
                                        Get Skipper
                                        <ExternalLink className="w-3 h-3 opacity-60" />
                                    </SettingsPrimaryButton>
                                }
                            />
                        ) : null}
                        {showAdmiralUpgradeCard ? (
                            <UpgradeCard
                                tone="brand"
                                icon={<ShipWheel className="h-4 w-4" />}
                                title="Admiral"
                                blurb="For teams managing shared infrastructure."
                                features={[
                                    ...(license?.variant === 'skipper' ? ['Everything in Skipper'] : ['Everything in Community']),
                                    'Unlimited accounts & scoped RBAC',
                                    ...(license?.variant !== 'skipper' ? ['Fleet View, webhooks & labels', 'Atomic deployments & backups'] : []),
                                    'LDAP/AD, audit log & host console',
                                    'API tokens & private registries',
                                    'Scheduled operations',
                                ]}
                                action={
                                    showSkipperCard ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="w-full"
                                            onClick={() => window.open(ADMIRAL_MONTHLY_CHECKOUT_URL, '_blank')}
                                        >
                                            <Zap className="w-4 h-4" />
                                            Get Admiral
                                            <ExternalLink className="w-3 h-3 opacity-60" />
                                        </Button>
                                    ) : (
                                        <SettingsPrimaryButton
                                            size="sm"
                                            className="w-full"
                                            onClick={() => window.open(ADMIRAL_MONTHLY_CHECKOUT_URL, '_blank')}
                                        >
                                            <Zap className="w-4 h-4" />
                                            Get Admiral
                                            <ExternalLink className="w-3 h-3 opacity-60" />
                                        </SettingsPrimaryButton>
                                    )
                                }
                            />
                        ) : null}
                    </div>
                </SettingsSection>
            ) : null}

            {license?.status !== 'active' ? (
                <SettingsSection title="Activate">
                    <SettingsField
                        label="License key"
                        helper="Paste the key from your activation email."
                        htmlFor="license-key"
                    >
                        <div className="flex gap-2">
                            <Input
                                id="license-key"
                                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                                value={licenseKeyInput}
                                onChange={(e) => setLicenseKeyInput(e.target.value)}
                                className="font-mono"
                            />
                            <SettingsPrimaryButton
                                onClick={async () => {
                                    if (!licenseKeyInput.trim()) return;
                                    setIsActivating(true);
                                    const result = await activate(licenseKeyInput.trim());
                                    if (result.success) {
                                        toast.success('License activated successfully.');
                                        setLicenseKeyInput('');
                                    } else {
                                        toast.error(result.error || 'Activation failed');
                                    }
                                    setIsActivating(false);
                                }}
                                disabled={isActivating || !licenseKeyInput.trim()}
                            >
                                {isActivating ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        Activating
                                    </>
                                ) : (
                                    'Activate'
                                )}
                            </SettingsPrimaryButton>
                        </div>
                    </SettingsField>
                </SettingsSection>
            ) : null}
        </div>
    );
}

interface UpgradeCardProps {
    tone: 'warn' | 'brand';
    icon: React.ReactNode;
    title: string;
    blurb: string;
    features: string[];
    action: React.ReactNode;
}

function UpgradeCard({ tone, icon, title, blurb, features, action }: UpgradeCardProps) {
    const iconClass = tone === 'warn' ? 'text-warning' : 'text-brand';
    return (
        <div className="border border-card-border rounded-md bg-card p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <span className={iconClass}>{icon}</span>
                <span className="font-sans text-base text-stat-value">{title}</span>
            </div>
            <p className="text-xs text-stat-subtitle">{blurb}</p>
            <ul className="space-y-1.5 flex-1">
                {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-stat-subtitle">
                        <Check className="h-3 w-3 shrink-0 text-brand mt-0.5" />
                        {f}
                    </li>
                ))}
            </ul>
            <div className="mt-auto">{action}</div>
        </div>
    );
}
