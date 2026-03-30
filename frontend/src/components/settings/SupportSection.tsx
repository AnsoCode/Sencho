import { Button } from '@/components/ui/button';
import { useLicense } from '@/context/LicenseContext';
import { TierBadge } from '@/components/TierBadge';
import { Book, Bug, Mail, ExternalLink, Crown } from 'lucide-react';

export function SupportSection() {
    const { isPro, license } = useLicense();

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold tracking-tight">Help & Support</h3>
                <p className="text-sm text-muted-foreground">Get help with Sencho based on your plan.</p>
            </div>

            {/* Self-serve channels (all tiers) */}
            <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Resources</h4>
                <div className="grid gap-3">
                    <a href="https://docs.sencho.io" target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-3 p-3 rounded-lg border border-glass-border hover:bg-muted/50 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            <Book className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">Documentation</p>
                            <p className="text-xs text-muted-foreground">Guides, reference, and tutorials</p>
                        </div>
                        <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                    </a>
                    <a href="https://github.com/AnsoCode/Sencho/issues" target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-3 p-3 rounded-lg border border-glass-border hover:bg-muted/50 transition-colors">
                        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            <Bug className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">GitHub Issues</p>
                            <p className="text-xs text-muted-foreground">Report bugs and request features</p>
                        </div>
                        <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                    </a>
                </div>
            </div>

            {/* Pro support channels */}
            {isPro && (
                <div className="space-y-3">
                    <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        Pro Support <TierBadge />
                    </h4>
                    <div className="grid gap-3">
                        <a href={license?.variant === 'team' ? 'mailto:support@sencho.io' : 'mailto:licensing@sencho.io'}
                           className="flex items-center gap-3 p-3 rounded-lg border border-glass-border hover:bg-muted/50 transition-colors">
                            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                <Mail className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">
                                    {license?.variant === 'team' ? 'Priority Email Support' : 'Email Support'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {license?.variant === 'team'
                                        ? 'Direct support with responses within 24 hours'
                                        : 'Reach our support team directly'}
                                </p>
                            </div>
                            <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
                        </a>
                    </div>
                </div>
            )}

            {/* Upsell for Community */}
            {!isPro && (
                <div className="rounded-lg border border-glass-border p-4 bg-muted/30">
                    <div className="flex items-start gap-3">
                        <Crown className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                            <p className="text-sm font-medium">Need faster support?</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Upgrade to Pro for direct email support and priority issue handling.
                            </p>
                            <Button size="sm" className="mt-3" onClick={() => window.open('https://sencho.io/#pricing', '_blank')}>
                                Upgrade to Pro
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
