import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLicense } from '@/context/LicenseContext';
import { RefreshCw, Database, Info } from 'lucide-react';
import type { PatchableSettings } from './types';

interface DeveloperSectionProps {
    settings: PatchableSettings;
    onSettingChange: <K extends keyof PatchableSettings>(key: K, value: PatchableSettings[K]) => void;
    onSave: () => Promise<void>;
    isSaving: boolean;
    isLoading: boolean;
    isRemote: boolean;
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

export function DeveloperSection({ settings, onSettingChange, onSave, isSaving, isLoading, isRemote }: DeveloperSectionProps) {
    const { isPaid, license } = useLicense();

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between pr-8">
                <div>
                    <h3 className="text-lg font-medium tracking-tight">Developer</h3>
                    <p className="text-sm text-muted-foreground">Power user settings for real-time observability and data retention.</p>
                </div>
                {isRemote && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Badge variant="secondary" className="text-xs shrink-0 ml-2 mt-0.5 cursor-help">
                                    <Info className="w-3 h-3 mr-1" />
                                    Always Local
                                </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[220px] text-center">
                                These settings control this Sencho instance's UI behaviour and are never synced to remote nodes.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>

            {isLoading ? <SettingsSkeleton /> : (
                <>
                    <div className="space-y-6 bg-glass border border-glass-border p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="developer_mode" className="text-base">Developer Mode</Label>
                                <p className="text-xs text-muted-foreground">Enable Real-Time Metrics & Extended Logs</p>
                            </div>
                            <Switch
                                id="developer_mode"
                                checked={settings.developer_mode === '1'}
                                onCheckedChange={(c) => onSettingChange('developer_mode', c ? '1' : '0')}
                            />
                        </div>

                        <div className="space-y-2 pt-4 border-t border-glass-border">
                            <Label className={`text-base ${settings.developer_mode === '1' ? 'text-muted-foreground' : ''}`}>
                                Standard Log Polling Rate
                            </Label>
                            <Select
                                value={settings.global_logs_refresh}
                                onValueChange={(val) => onSettingChange('global_logs_refresh', val as '1' | '3' | '5' | '10')}
                                disabled={settings.developer_mode === '1'}
                            >
                                <SelectTrigger className="max-w-[200px]">
                                    <SelectValue placeholder="Select rate" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">1 second</SelectItem>
                                    <SelectItem value="3">3 seconds</SelectItem>
                                    <SelectItem value="5">5 seconds</SelectItem>
                                    <SelectItem value="10">10 seconds</SelectItem>
                                </SelectContent>
                            </Select>
                            {settings.developer_mode === '1' && (
                                <p className="text-xs text-warning">SSE streaming is active - polling rate is overridden.</p>
                            )}
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

                            {isPaid && license?.variant === 'team' && (
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
