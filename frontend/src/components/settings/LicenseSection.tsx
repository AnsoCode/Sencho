import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast-store';
import { useLicense } from '@/context/LicenseContext';
import { TierBadge } from '@/components/TierBadge';
import {
    Crown, CheckCircle, Check, XCircle, Clock, ExternalLink,
    CreditCard, RefreshCw, Zap, Compass, ShipWheel, Loader2,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';

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
    // Trial CTA owns the Admiral path for unlicensed users; the Admiral upgrade card is reserved for the
    // Skipper-active upgrade path. Otherwise both would link to the same LS checkout for community users.
    const showTrialCta = license?.status !== 'active' && license?.status !== 'trial';
    const showAdmiralUpgradeCard = !isAdmiral && !showTrialCta;
    const showUpgradeCards = showSkipperCard || showAdmiralUpgradeCard;

    return (
        <div className="space-y-6">
            {/* Current Tier Display */}
            <div className="bg-glass border border-glass-border p-4 rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isPaid ? (
                            <CheckCircle className="w-5 h-5 text-success" />
                        ) : (
                            <Crown className="w-5 h-5 text-muted-foreground" />
                        )}
                        <span className="font-medium text-base">
                            {getTierDisplayName(license?.tier, license?.variant, license?.status)}
                        </span>
                    </div>
                    <TierBadge />
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
                        {(license.isLifetime || license.validUntil) && (
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">{license.isLifetime ? 'Duration' : 'Renews'}</span>
                                <span>{license.isLifetime ? 'Lifetime' : new Date(license.validUntil!).toLocaleDateString()}</span>
                            </div>
                        )}
                    </div>
                )}

                {license?.status === 'expired' && (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                        <XCircle className="w-4 h-4" />
                        <span>Your license has expired. Renew to restore paid features.</span>
                    </div>
                )}

                {license?.status === 'disabled' && (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                        <XCircle className="w-4 h-4" />
                        <span>Your license has been disabled. Contact support for assistance.</span>
                    </div>
                )}
            </div>

            {/* Manage Subscription (active paid license) */}
            {license?.status === 'active' && (
                <div className="space-y-3">
                    {!license.isLifetime && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={openBillingPortal}
                            disabled={billingLoading}
                        >
                            {billingLoading ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <CreditCard className="w-4 h-4 mr-2" />
                            )}
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

            {showTrialCta && (
                <div className="border border-glass-border rounded-lg p-4 space-y-3 bg-glass">
                    <div className="flex items-center gap-2">
                        <ShipWheel className="w-4 h-4 text-blue-500" />
                        <span className="font-medium text-sm">Try Admiral free for 14 days</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Admiral unlocks Host Console, Scheduled Operations, LDAP / Active Directory, audit log, API tokens, and unlimited accounts. Starting a trial opens Lemon Squeezy checkout, which requires a card for verification; you can cancel any time before day 14.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Button
                            size="sm"
                            onClick={() => window.open(ADMIRAL_MONTHLY_CHECKOUT_URL, '_blank')}
                        >
                            Start monthly trial
                            <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(ADMIRAL_ANNUAL_CHECKOUT_URL, '_blank')}
                        >
                            Start annual trial
                            <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                        </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        After checkout, paste the license key from your email into the activate field below.
                    </p>
                </div>
            )}

            {showUpgradeCards && (
                <div className="space-y-3">
                    <Label className="text-base">Upgrade your plan</Label>
                    <div className={`grid gap-3 ${showSkipperCard && showAdmiralUpgradeCard ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                        {showSkipperCard && (
                            <div className="relative border border-glass-border rounded-lg p-4 space-y-3 bg-glass flex flex-col">
                                <div className="flex items-center gap-2">
                                    <Compass className="w-4 h-4 text-amber-500" />
                                    <span className="font-medium text-sm">Skipper</span>
                                    <Badge variant="secondary" className="text-[10px] font-medium uppercase px-1.5 py-0">Popular</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">Professional tools for solo operators.</p>
                                <ul className="space-y-1.5">
                                    {['Fleet View with drill-down', 'Viewer accounts (1 admin + 3 viewers)', 'Webhooks & stack labels', 'Atomic deployments & backups', 'Auto-update policies', 'Google / GitHub / Okta SSO'].map((f) => (
                                        <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Check className="w-3 h-3 shrink-0 text-success" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    size="sm"
                                    className="w-full mt-auto"
                                    onClick={() => window.open(SKIPPER_CHECKOUT_URL, '_blank')}
                                >
                                    <Zap className="w-4 h-4 mr-2" />
                                    Get Skipper
                                    <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                                </Button>
                            </div>
                        )}

                        {showAdmiralUpgradeCard && (
                            <div className="border border-glass-border rounded-lg p-4 space-y-3 bg-glass flex flex-col">
                                <div className="flex items-center gap-2">
                                    <ShipWheel className="w-4 h-4 text-blue-500" />
                                    <span className="font-medium text-sm">Admiral</span>
                                </div>
                                <p className="text-xs text-muted-foreground">For teams managing shared infrastructure.</p>
                                <ul className="space-y-1.5">
                                    {[
                                        ...(license?.variant === 'skipper' ? ['Everything in Skipper'] : ['Everything in Community']),
                                        'Unlimited accounts & scoped RBAC',
                                        ...(license?.variant !== 'skipper' ? ['Fleet View, webhooks & labels', 'Atomic deployments & backups'] : []),
                                        'LDAP/AD, audit log & host console',
                                        'API tokens & private registries',
                                        'Scheduled operations',
                                    ].map((f) => (
                                        <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Check className="w-3 h-3 shrink-0 text-success" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    size="sm"
                                    variant={showSkipperCard ? 'outline' : 'default'}
                                    className="w-full mt-auto"
                                    onClick={() => window.open(ADMIRAL_MONTHLY_CHECKOUT_URL, '_blank')}
                                >
                                    <Zap className="w-4 h-4 mr-2" />
                                    Get Admiral
                                    <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* License key activation */}
            {license?.status !== 'active' && (
                <div className="border-t border-glass-border pt-4 space-y-2">
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
                                    toast.success('License activated successfully.');
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
            )}
        </div>
    );
}
