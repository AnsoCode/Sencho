import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PatchableSettings } from './types';

interface SystemSectionProps {
    settings: PatchableSettings;
    onSettingChange: <K extends keyof PatchableSettings>(key: K, value: PatchableSettings[K]) => void;
    onSave: () => Promise<void>;
    isSaving: boolean;
    isLoading: boolean;
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

export function SystemSection({ settings, onSettingChange, onSave, isSaving, isLoading }: SystemSectionProps) {
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
                <Button onClick={onSave} disabled={isSaving}>
                    {isSaving
                        ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                        : 'Save limits'
                    }
                </Button>
            </div>
        </div>
    );
}
