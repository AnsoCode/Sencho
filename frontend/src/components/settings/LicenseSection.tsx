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

function getTierDisplayName(tier?: string, variant?: string | null, status?: string): string {
    if (tier === 'paid' && variant === 'admiral' && status === 'active') return 'Sencho Admiral';
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
    const showUpgradeCards = !isAdmiral && (showSkipperCard || (license?.variant === 'skipper' && license?.status === 'active'));

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium tracking-tight">License</h3>
                <p className="text-sm text-muted-foreground">Manage your Sencho license.</p>
            </div>

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

            {/* Upgrade Cards: show for community, trial, or active Skipper users */}
            {showUpgradeCards && (
                <div className="space-y-3">
                    <Label className="text-base">Upgrade your plan</Label>
                    <div className={`grid gap-3 ${showSkipperCard ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                        {/* Skipper Card - only for Community users and trial users */}
                        {showSkipperCard && (
                            <div className="relative border border-glass-border rounded-lg p-4 space-y-3 bg-glass flex flex-col">
                                <div className="flex items-center gap-2">
                                    <Compass className="w-4 h-4 text-amber-500" />
                                    <span className="font-medium text-sm">Skipper</span>
                                    <Badge variant="secondary" className="text-[10px] font-medium uppercase px-1.5 py-0">Popular</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">Professional tools for solo operators.</p>
                                <ul className="space-y-1.5">
                                    {['Fleet View with drill-down', 'Viewer accounts (1 admin + 3 viewers)', 'Webhooks & stack labels', 'Atomic deployments & backups', 'Auto-update policies'].map((f) => (
                                        <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Check className="w-3 h-3 shrink-0 text-success" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                                <Button
                                    size="sm"
                                    className="w-full mt-auto"
                                    onClick={() => window.open('https://saelix.lemonsqueezy.com/checkout/buy/f75bfb65-443a-46a0-abb1-981e0ff4b382', '_blank')}
                                >
                                    <Zap className="w-4 h-4 mr-2" />
                                    Get Skipper
                                    <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                                </Button>
                            </div>
                        )}

                        {/* Admiral Card */}
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
                                    'SSO, audit log & host console',
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
                                onClick={() => window.open('https://saelix.lemonsqueezy.com/checkout/buy/b049b824-176a-408d-a9d3-9365c979a61f', '_blank')}
                            >
                                <Zap className="w-4 h-4 mr-2" />
                                Get Admiral
                                <ExternalLink className="w-3 h-3 ml-1.5 opacity-50" />
                            </Button>
                        </div>
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
