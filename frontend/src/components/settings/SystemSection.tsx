import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/ui/toast-store';
import { useNodes } from '@/context/NodeContext';
import { DEFAULT_SETTINGS } from './types';
import type { PatchableSettings } from './types';

interface SystemSectionProps {
    onDirtyChange?: (dirty: boolean) => void;
}

interface NumberChipProps {
    value: string;
    onChange: (v: string) => void;
    suffix: string;
    min?: number;
    max?: number;
    step?: number;
    warnOver?: number;
}

function NumberChip({ value, onChange, suffix, min, max, step = 1, warnOver }: NumberChipProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (editing) inputRef.current?.select();
    }, [editing]);

    const startEdit = () => {
        setDraft(value);
        setEditing(true);
    };

    const commit = () => {
        const trimmed = draft.trim();
        const parsed = Number(trimmed);
        if (trimmed !== '' && Number.isFinite(parsed)) {
            let next = parsed;
            if (typeof min === 'number') next = Math.max(min, next);
            if (typeof max === 'number') next = Math.min(max, next);
            onChange(String(next));
        }
        setEditing(false);
    };

    const numeric = Number(value);
    const warn = typeof warnOver === 'number' && Number.isFinite(numeric) && numeric > warnOver;

    const chipClass = cn(
        'inline-flex items-baseline gap-1 rounded-md border px-2.5 py-1 font-mono text-sm tabular-nums tracking-tight transition-colors min-w-[78px] justify-end focus-within:ring-2 focus-within:ring-brand/50 focus-within:outline-none',
        warn
            ? 'border-warning/40 bg-warning/10 text-warning'
            : 'border-card-border bg-card text-stat-value hover:border-brand/50',
    );

    if (editing) {
        return (
            <span className={chipClass}>
                <input
                    ref={inputRef}
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commit();
                        if (e.key === 'Escape') setEditing(false);
                    }}
                    className="w-12 bg-transparent text-right outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-stat-subtitle">{suffix}</span>
            </span>
        );
    }

    return (
        <button
            type="button"
            className={cn(chipClass, 'focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none')}
            onClick={startEdit}
        >
            <span>{value || '0'}</span>
            <span className="text-stat-subtitle">{suffix}</span>
        </button>
    );
}

interface TogglePillProps {
    checked: boolean;
    onChange: (next: boolean) => void;
}

function TogglePill({ checked, onChange }: TogglePillProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={cn(
                'inline-flex items-center justify-center rounded-md border px-2.5 py-1 font-mono text-xs uppercase tracking-[0.18em] transition-colors min-w-[60px] focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none',
                checked
                    ? 'border-success/30 bg-success/10 text-success hover:bg-success/15'
                    : 'border-card-border bg-card text-stat-subtitle hover:text-stat-value',
            )}
        >
            {checked ? 'ON' : 'OFF'}
        </button>
    );
}

interface RowProps {
    label: string;
    desc: string;
    control: React.ReactNode;
    last?: boolean;
}

function Row({ label, desc, control, last }: RowProps) {
    return (
        <div
            className={cn(
                'flex items-center gap-4 px-4 py-3',
                !last && 'border-b border-glass-border',
            )}
        >
            <div className="min-w-0 flex-1">
                <div className="text-sm text-stat-value">{label}</div>
                <div className="mt-0.5 text-xs text-stat-subtitle">{desc}</div>
            </div>
            <div className="shrink-0">{control}</div>
        </div>
    );
}

function SettingsSkeleton() {
    return (
        <div className="space-y-3 rounded-lg border border-glass-border bg-glass p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
        </div>
    );
}

type SystemFields = Pick<PatchableSettings, 'host_cpu_limit' | 'host_ram_limit' | 'host_disk_limit' | 'docker_janitor_gb' | 'global_crash'>;

const DEFAULT_SYSTEM: SystemFields = {
    host_cpu_limit: DEFAULT_SETTINGS.host_cpu_limit,
    host_ram_limit: DEFAULT_SETTINGS.host_ram_limit,
    host_disk_limit: DEFAULT_SETTINGS.host_disk_limit,
    docker_janitor_gb: DEFAULT_SETTINGS.docker_janitor_gb,
    global_crash: DEFAULT_SETTINGS.global_crash,
};

export function SystemSection({ onDirtyChange }: SystemSectionProps) {
    const { activeNode } = useNodes();
    const [settings, setSettings] = useState<SystemFields>({ ...DEFAULT_SYSTEM });
    const serverSettingsRef = useRef<SystemFields>({ ...DEFAULT_SYSTEM });
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const hasChanges =
        settings.host_cpu_limit !== serverSettingsRef.current.host_cpu_limit ||
        settings.host_ram_limit !== serverSettingsRef.current.host_ram_limit ||
        settings.host_disk_limit !== serverSettingsRef.current.host_disk_limit ||
        settings.docker_janitor_gb !== serverSettingsRef.current.docker_janitor_gb ||
        settings.global_crash !== serverSettingsRef.current.global_crash;

    useEffect(() => {
        onDirtyChange?.(hasChanges);
    }, [hasChanges, onDirtyChange]);

    useEffect(() => {
        const fetchSettings = async () => {
            setIsLoading(true);
            try {
                const nodeRes = await apiFetch('/settings');
                const nodeData: Record<string, string> = nodeRes.ok ? await nodeRes.json() : {};
                const safe: SystemFields = {
                    host_cpu_limit: nodeData.host_cpu_limit ?? DEFAULT_SETTINGS.host_cpu_limit,
                    host_ram_limit: nodeData.host_ram_limit ?? DEFAULT_SETTINGS.host_ram_limit,
                    host_disk_limit: nodeData.host_disk_limit ?? DEFAULT_SETTINGS.host_disk_limit,
                    docker_janitor_gb: nodeData.docker_janitor_gb ?? DEFAULT_SETTINGS.docker_janitor_gb,
                    global_crash: (nodeData.global_crash as '0' | '1') ?? DEFAULT_SETTINGS.global_crash,
                };
                setSettings(safe);
                serverSettingsRef.current = { ...safe };
            } catch (e) {
                console.error('Failed to fetch system settings', e);
            } finally {
                setIsLoading(false);
            }
        };
        fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeNode?.id]);

    const onSettingChange = <K extends keyof SystemFields>(key: K, value: SystemFields[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const saveSettings = async () => {
        setIsSaving(true);
        try {
            const res = await apiFetch('/settings', {
                method: 'PATCH',
                body: JSON.stringify(settings),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                toast.error(err?.error || err?.message || 'Failed to save settings.');
                return;
            }
            serverSettingsRef.current = { ...settings };
            toast.success('System limits saved.');
        } catch (e: unknown) {
            toast.error((e as Error)?.message || 'Something went wrong.');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return <SettingsSkeleton />;

    return (
        <div className="space-y-6">
            <div className="overflow-hidden rounded-lg border border-glass-border bg-glass">
                <Row
                    label="Host CPU limit"
                    desc="Alerts fire when 5-min avg exceeds"
                    control={
                        <NumberChip
                            value={settings.host_cpu_limit || '90'}
                            onChange={(v) => onSettingChange('host_cpu_limit', v)}
                            suffix="%"
                            min={1}
                            max={100}
                            warnOver={95}
                        />
                    }
                />
                <Row
                    label="Host RAM limit"
                    desc="Swap is never acceptable"
                    control={
                        <NumberChip
                            value={settings.host_ram_limit || '90'}
                            onChange={(v) => onSettingChange('host_ram_limit', v)}
                            suffix="%"
                            min={1}
                            max={100}
                            warnOver={95}
                        />
                    }
                />
                <Row
                    label="Host disk limit"
                    desc="Low free space slows image pulls and backups"
                    control={
                        <NumberChip
                            value={settings.host_disk_limit || '90'}
                            onChange={(v) => onSettingChange('host_disk_limit', v)}
                            suffix="%"
                            min={1}
                            max={100}
                            warnOver={95}
                        />
                    }
                />
                <Row
                    label="Janitor threshold"
                    desc="Alert when reclaimable Docker data exceeds this"
                    control={
                        <NumberChip
                            value={settings.docker_janitor_gb || '5'}
                            onChange={(v) => onSettingChange('docker_janitor_gb', v)}
                            suffix="GiB"
                            min={0}
                            step={0.5}
                            warnOver={10}
                        />
                    }
                />
                <Row
                    last
                    label="Global crash capture"
                    desc="Watch every managed container for unexpected exits"
                    control={
                        <TogglePill
                            checked={settings.global_crash === '1'}
                            onChange={(next) => onSettingChange('global_crash', next ? '1' : '0')}
                        />
                    }
                />
            </div>

            <div className="flex justify-end">
                <Button onClick={saveSettings} disabled={isSaving}>
                    {isSaving
                        ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                        : 'Save limits'
                    }
                </Button>
            </div>
        </div>
    );
}
