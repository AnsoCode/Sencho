import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Info } from 'lucide-react';
import type { PatchableSettings } from './types';

interface SystemSectionProps {
    settings: PatchableSettings;
    onSettingChange: <K extends keyof PatchableSettings>(key: K, value: PatchableSettings[K]) => void;
    onSave: () => Promise<void>;
    isSaving: boolean;
    isLoading: boolean;
    isRemote: boolean;
    activeNodeName?: string;
}

function SettingsSkeleton() {
    return (
        <div className="space-y-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="space-y-4 bg-glass border border-glass-border backdrop-blur-sm p-4 rounded-xl">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        </div>
    );
}

export function SystemSection({ settings, onSettingChange, onSave, isSaving, isLoading, isRemote, activeNodeName }: SystemSectionProps) {
    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between pr-8">
                <div>
                    <h3 className="text-lg font-semibold tracking-tight">System Limits & Watchdog</h3>
                    <p className="text-sm text-muted-foreground">Configure alert thresholds and crash detection.</p>
                </div>
                {isRemote && (
                    <Badge variant="outline" className="text-xs shrink-0 ml-2 mt-0.5">
                        <Info className="w-3 h-3 mr-1" />
                        Configuring: {activeNodeName}
                    </Badge>
                )}
            </div>

            {isLoading ? <SettingsSkeleton /> : (
                <>
                    <div className="space-y-6 bg-glass border border-glass-border backdrop-blur-sm p-4 rounded-xl">
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <Label className="text-base">Host CPU Alert Threshold</Label>
                                <span className="text-sm font-medium">{settings.host_cpu_limit}%</span>
                            </div>
                            <Slider
                                min={1} max={100} step={1}
                                value={[parseInt(settings.host_cpu_limit || '90')]}
                                onValueChange={(v) => onSettingChange('host_cpu_limit', v[0].toString())}
                            />
                        </div>

                        <div className="space-y-4 pt-2 border-t border-glass-border">
                            <div className="flex justify-between items-center">
                                <Label className="text-base">Host RAM Alert Threshold</Label>
                                <span className="text-sm font-medium">{settings.host_ram_limit}%</span>
                            </div>
                            <Slider
                                min={1} max={100} step={1}
                                value={[parseInt(settings.host_ram_limit || '90')]}
                                onValueChange={(v) => onSettingChange('host_ram_limit', v[0].toString())}
                            />
                        </div>

                        <div className="space-y-4 pt-2 border-t border-glass-border">
                            <div className="flex justify-between items-center">
                                <Label className="text-base">Host Disk Alert Threshold</Label>
                                <span className="text-sm font-medium">{settings.host_disk_limit}%</span>
                            </div>
                            <Slider
                                min={1} max={100} step={1}
                                value={[parseInt(settings.host_disk_limit || '90')]}
                                onValueChange={(v) => onSettingChange('host_disk_limit', v[0].toString())}
                            />
                        </div>

                        <div className="space-y-2 pt-2 border-t border-glass-border">
                            <Label className="text-base">Docker Janitor Storage Threshold</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="number"
                                    min={0}
                                    step={0.5}
                                    value={settings.docker_janitor_gb}
                                    onChange={(e) => onSettingChange('docker_janitor_gb', e.target.value)}
                                    className="max-w-[150px]"
                                />
                                <span className="text-sm text-muted-foreground">GB reclaimable</span>
                            </div>
                            <p className="text-xs text-muted-foreground">Alert when unused Docker data exceeds this size.</p>
                        </div>

                        <div className="flex items-center justify-between pt-4 border-t border-glass-border">
                            <div className="space-y-0.5">
                                <Label htmlFor="global_crash" className="text-base">Global Crash Detection</Label>
                                <p className="text-xs text-muted-foreground">Watch all containers for unexpected exits</p>
                            </div>
                            <Switch
                                id="global_crash"
                                checked={settings.global_crash === '1'}
                                onCheckedChange={(c) => onSettingChange('global_crash', c ? '1' : '0')}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <Button onClick={onSave} disabled={isSaving}>
                            {isSaving
                                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                                : 'Save Limits'
                            }
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
