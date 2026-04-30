import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TogglePill } from '@/components/ui/toggle-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { useLicense } from '@/context/LicenseContext';
import { RefreshCw, Database } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { useNodes } from '@/context/NodeContext';
import { SENCHO_SETTINGS_CHANGED } from '@/lib/events';
import type { SenchoSettingsChangedDetail } from '@/lib/events';
import { DEFAULT_SETTINGS } from './types';
import type { PatchableSettings } from './types';

interface DeveloperSectionProps {
    onDirtyChange?: (dirty: boolean) => void;
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

type DeveloperFields = Pick<PatchableSettings, 'developer_mode' | 'metrics_retention_hours' | 'log_retention_days' | 'audit_retention_days'>;

const DEFAULT_DEVELOPER: DeveloperFields = {
    developer_mode: DEFAULT_SETTINGS.developer_mode,
    metrics_retention_hours: DEFAULT_SETTINGS.metrics_retention_hours,
    log_retention_days: DEFAULT_SETTINGS.log_retention_days,
    audit_retention_days: DEFAULT_SETTINGS.audit_retention_days,
};

export function DeveloperSection({ onDirtyChange }: DeveloperSectionProps) {
    const { isPaid, license } = useLicense();
    const { activeNode } = useNodes();
    const [settings, setSettings] = useState<DeveloperFields>({ ...DEFAULT_DEVELOPER });
    const serverSettingsRef = useRef<DeveloperFields>({ ...DEFAULT_DEVELOPER });
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const hasChanges =
        settings.developer_mode !== serverSettingsRef.current.developer_mode ||
        settings.metrics_retention_hours !== serverSettingsRef.current.metrics_retention_hours ||
        settings.log_retention_days !== serverSettingsRef.current.log_retention_days ||
        settings.audit_retention_days !== serverSettingsRef.current.audit_retention_days;

    useEffect(() => {
        onDirtyChange?.(hasChanges);
    }, [hasChanges, onDirtyChange]);

    useEffect(() => {
        const fetchSettings = async () => {
            setIsLoading(true);
            try {
                const isRemote = activeNode?.type === 'remote';
                const nodeRes = await apiFetch('/settings');
                const localRes = isRemote ? await apiFetch('/settings', { localOnly: true }) : nodeRes;
                const nodeData: Record<string, string> = nodeRes.ok ? await nodeRes.json() : {};
                const localData: Record<string, string> = (isRemote && localRes.ok)
                    ? await localRes.json()
                    : nodeData;
                const safe: DeveloperFields = {
                    developer_mode: (localData.developer_mode as '0' | '1') ?? DEFAULT_SETTINGS.developer_mode,
                    metrics_retention_hours: localData.metrics_retention_hours ?? DEFAULT_SETTINGS.metrics_retention_hours,
                    log_retention_days: localData.log_retention_days ?? DEFAULT_SETTINGS.log_retention_days,
                    audit_retention_days: localData.audit_retention_days ?? DEFAULT_SETTINGS.audit_retention_days,
                };
                setSettings(safe);
                serverSettingsRef.current = { ...safe };
            } catch (e) {
                console.error('Failed to fetch developer settings', e);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeNode?.id]);

    const onSettingChange = <K extends keyof DeveloperFields>(key: K, value: DeveloperFields[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const saveSettings = async () => {
        const payload = {
            developer_mode: settings.developer_mode,
            metrics_retention_hours: settings.metrics_retention_hours,
            log_retention_days: settings.log_retention_days,
            audit_retention_days: settings.audit_retention_days,
        };
        setIsSaving(true);
        try {
            const res = await apiFetch('/settings', {
                method: 'PATCH',
                body: JSON.stringify(payload),
                localOnly: true,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to save settings.');
                return;
            }
            serverSettingsRef.current = { ...settings };
            toast.success('Developer settings saved.');
            window.dispatchEvent(new CustomEvent<SenchoSettingsChangedDetail>(SENCHO_SETTINGS_CHANGED, {
                detail: { changedKeys: Object.keys(payload) },
            }));
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Something went wrong.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {isLoading ? <SettingsSkeleton /> : (
                <>
                    <div className="space-y-6 bg-glass border border-glass-border p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="developer_mode" className="text-base">Developer Mode</Label>
                                <p className="text-xs text-muted-foreground">Enable Real-Time Metrics and Debug Diagnostics</p>
                            </div>
                            <TogglePill
                                id="developer_mode"
                                checked={settings.developer_mode === '1'}
                                onChange={(c) => onSettingChange('developer_mode', c ? '1' : '0')}
                            />
                        </div>
                    </div>

                    {/* Data Retention (Observability) */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">Data Retention</span>
                        </div>
                        <div className="space-y-4 bg-glass border border-glass-border p-4 rounded-lg">
                            <div className="flex items-center justify-between gap-4">
                                <div className="space-y-0.5">
                                    <Label className="text-base">Container Metrics Retention</Label>
                                    <p className="text-xs text-muted-foreground">How long to keep per-container CPU/RAM/network history.</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Input
                                        type="number"
                                        min={1}
                                        max={8760}
                                        value={settings.metrics_retention_hours}
                                        onChange={(e) => onSettingChange('metrics_retention_hours', e.target.value)}
                                        className="w-20"
                                    />
                                    <span className="text-sm text-muted-foreground w-8">hrs</span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-4 pt-4 border-t border-glass-border">
                                <div className="space-y-0.5">
                                    <Label className="text-base">Notification Log Retention</Label>
                                    <p className="text-xs text-muted-foreground">How long to keep alert and notification history.</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <Input
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={settings.log_retention_days}
                                        onChange={(e) => onSettingChange('log_retention_days', e.target.value)}
                                        className="w-20"
                                    />
                                    <span className="text-sm text-muted-foreground w-8">days</span>
                                </div>
                            </div>

                            {isPaid && license?.variant === 'admiral' && (
                                <div className="flex items-center justify-between gap-4 pt-4 border-t border-glass-border">
                                    <div className="space-y-0.5">
                                        <Label className="text-base">Audit Log Retention</Label>
                                        <p className="text-xs text-muted-foreground">How long to keep audit trail entries.</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={365}
                                            value={settings.audit_retention_days}
                                            onChange={(e) => onSettingChange('audit_retention_days', e.target.value)}
                                            className="w-20"
                                        />
                                        <span className="text-sm text-muted-foreground w-8">days</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <Button onClick={saveSettings} disabled={isSaving}>
                            {isSaving
                                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                                : 'Save Developer Settings'
                            }
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
