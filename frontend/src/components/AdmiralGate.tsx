import { type ReactNode, useState } from 'react';
import { ShipWheel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLicense } from '@/context/LicenseContext';

interface AdmiralGateProps {
    children: ReactNode;
    featureName?: string;
}

const DISMISS_KEY = 'sencho-admiral-upgrade-prompt-dismissed';
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

function isDismissedFromStorage(): boolean {
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    return !!dismissedAt && Date.now() - parseInt(dismissedAt, 10) < DISMISS_DURATION_MS;
}

export function AdmiralGate({ children, featureName = 'This feature' }: AdmiralGateProps) {
    const { isPro, license } = useLicense();
    const [dismissed, setDismissed] = useState(isDismissedFromStorage);

    if (isPro && license?.variant === 'team') return <>{children}</>;

    if (dismissed) {
        return (
            <div className="relative">
                <div className="opacity-40 pointer-events-none select-none blur-[2px]">
                    {children}
                </div>
                <div className="absolute inset-0 flex items-start justify-center pt-8">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/80 border border-border text-muted-foreground text-xs">
                        <ShipWheel className="w-3 h-3" />
                        Upgrade to Admiral to unlock
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-muted/50 border border-border">
                <ShipWheel className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="text-center max-w-md">
                <h3 className="text-lg font-semibold mb-2">{featureName} requires Sencho Admiral</h3>
                <p className="text-sm text-muted-foreground">
                    Unlock team features like SSO authentication, audit logging, API tokens, and unlimited user accounts with a Sencho Admiral license.
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
                    <ShipWheel className="w-4 h-4 mr-2" />
                    Get Admiral
                </Button>
            </div>
        </div>
    );
}
