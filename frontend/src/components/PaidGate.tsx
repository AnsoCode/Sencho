import { type ReactNode, useState } from 'react';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLicense } from '@/context/LicenseContext';

interface PaidGateProps {
    children: ReactNode;
    featureName?: string;
    // Inline compact lock for list items (e.g. a single SSO provider card). Skips
    // the full-page upsell and dismiss timer; always renders the blurred + pill style.
    compact?: boolean;
}

const DISMISS_KEY = 'sencho-upgrade-prompt-dismissed';
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours (session-like)

function isDismissedFromStorage(): boolean {
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    return !!dismissedAt && Date.now() - parseInt(dismissedAt, 10) < DISMISS_DURATION_MS;
}

export function PaidGate({ children, featureName = 'This feature', compact = false }: PaidGateProps) {
    const { isPaid } = useLicense();
    const [dismissed, setDismissed] = useState(isDismissedFromStorage);

    if (isPaid) return <>{children}</>;

    if (compact || dismissed) {
        return (
            <div className="relative">
                <div className="opacity-40 pointer-events-none select-none blur-[2px]">
                    {children}
                </div>
                <div className="absolute inset-0 flex items-start justify-center pt-8">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/80 border border-border text-muted-foreground text-xs">
                        <Compass className="w-3 h-3" />
                        Upgrade to unlock {featureName}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted/50 border border-border">
                <Compass className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="text-center max-w-md">
                <h3 className="text-lg font-semibold mb-2">{featureName} requires a paid license</h3>
                <p className="text-sm text-muted-foreground">
                    Unlock features like fleet management, viewer accounts, one-click Google / GitHub / Okta SSO, and more with a Skipper or Admiral license.
                    For enterprise pricing or questions, contact{' '}
                    <a href="mailto:licensing@sencho.io" className="text-brand hover:underline">licensing@sencho.io</a>.
                </p>
            </div>
            <div className="flex gap-3">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        localStorage.setItem(DISMISS_KEY, Date.now().toString());
                        setDismissed(true);
                    }}
                >
                    Dismiss
                </Button>
                <Button
                    size="sm"
                    onClick={() => window.open('https://sencho.io/pricing', '_blank')}
                >
                    <Compass className="w-4 h-4 mr-2" />
                    View Plans
                </Button>
            </div>
        </div>
    );
}
