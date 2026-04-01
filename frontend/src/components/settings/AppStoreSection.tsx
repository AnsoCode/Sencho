import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast-store';
import { apiFetch } from '@/lib/api';
import { RefreshCw } from 'lucide-react';
import type { PatchableSettings } from './types';

interface AppStoreSectionProps {
    settings: PatchableSettings;
    onSettingChange: <K extends keyof PatchableSettings>(key: K, value: PatchableSettings[K]) => void;
    isLoading: boolean;
    /** Called after a successful save so the parent can update serverSettingsRef */
    onSaved: (key: keyof PatchableSettings, value: string) => void;
}

function SettingsSkeleton() {
    return (
        <div className="space-y-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="space-y-4 bg-glass border border-glass-border p-4 rounded-lg">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        </div>
    );
}

export function AppStoreSection({ settings, onSettingChange, isLoading, onSaved }: AppStoreSectionProps) {
    const [isSavingRegistry, setIsSavingRegistry] = useState(false);

    const saveRegistrySettings = async () => {
        setIsSavingRegistry(true);
        try {
            const res = await apiFetch('/settings', {
                method: 'PATCH',
                body: JSON.stringify({ template_registry_url: settings.template_registry_url ?? '' }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to save registry settings.');
                return;
            }
            onSaved('template_registry_url', settings.template_registry_url ?? '');
            await apiFetch('/templates/refresh-cache', { method: 'POST' });
            toast.success('Registry saved. App Store will reload from the new source.');
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Failed to save registry settings.');
        } finally {
            setIsSavingRegistry(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium tracking-tight">App Store Registry</h3>
                <p className="text-sm text-muted-foreground">Configure the template source used by the App Store.</p>
            </div>

            {isLoading ? <SettingsSkeleton /> : (
                <>
                    <div className="space-y-6 bg-glass border border-glass-border p-4 rounded-lg">
                        <div className="space-y-1">
                            <Label className="text-base">Default Registry</Label>
                            <p className="text-xs text-muted-foreground">
                                LinuxServer.io - <span className="font-mono">https://api.linuxserver.io/api/v1/images</span>
                            </p>
                            <p className="text-xs text-muted-foreground">Used when no custom registry is set.</p>
                        </div>

                        <div className="space-y-3 pt-4 border-t border-glass-border">
                            <div className="space-y-1">
                                <Label className="text-base">Custom Registry URL</Label>
                                <p className="text-xs text-muted-foreground">
                                    Provide a URL pointing to a <span className="font-medium">Portainer v2</span> compatible template JSON file. Overrides the default registry.
                                </p>
                            </div>
                            <Input
                                placeholder="https://example.com/templates.json"
                                value={settings.template_registry_url ?? ''}
                                onChange={(e) => onSettingChange('template_registry_url', e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">Leave empty to use the default LinuxServer.io registry.</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onSettingChange('template_registry_url', '')}
                            disabled={isSavingRegistry || !settings.template_registry_url}
                        >
                            Reset to Default
                        </Button>
                        <Button onClick={saveRegistrySettings} disabled={isSavingRegistry}>
                            {isSavingRegistry
                                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                                : 'Save & Refresh'
                            }
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
