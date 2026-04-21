import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TogglePill } from '@/components/ui/toggle-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { useLicense } from '@/context/LicenseContext';
import { RefreshCw, Database } from 'lucide-react';
import type { PatchableSettings } from './types';

interface DeveloperSectionProps {
    settings: PatchableSettings;
    onSettingChange: <K extends keyof PatchableSettings>(key: K, value: PatchableSettings[K]) => void;
    onSave: () => Promise<void>;
    isSaving: boolean;
    isLoading: boolean;
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

export function DeveloperSection({ settings, onSettingChange, onSave, isSaving, isLoading }: DeveloperSectionProps) {
    const { isPaid, license } = useLicense();

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
                        <Button onClick={onSave} disabled={isSaving}>
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
