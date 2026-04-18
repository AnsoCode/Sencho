import { Badge } from '@/components/ui/badge';
import { useLicense } from '@/context/LicenseContext';
import { TierBadge } from '@/components/TierBadge';

export function AboutSection() {
    const { license } = useLicense();

    return (
        <div className="space-y-6">
            <div className="space-y-4 bg-glass border border-glass-border p-4 rounded-lg">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Version</span>
                    <Badge variant="secondary" className="font-mono">v{__APP_VERSION__}</Badge>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Tier</span>
                    <div><TierBadge /></div>
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">License Status</span>
                    <Badge variant="outline" className="capitalize">{license?.status ?? 'community'}</Badge>
                </div>
                {license?.instanceId && (
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Instance ID</span>
                        <code className="text-xs font-mono bg-muted px-2 py-1 rounded">{license.instanceId.slice(0, 8)}</code>
                    </div>
                )}
            </div>

            <div className="space-y-2">
                <h4 className="text-sm font-medium">Links</h4>
                <div className="flex flex-col gap-1.5">
                    <a
                        href="https://github.com/AnsoCode/Sencho/blob/main/CHANGELOG.md"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Changelog &rarr;
                    </a>
                </div>
            </div>
        </div>
    );
}
