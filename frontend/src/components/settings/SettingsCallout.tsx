import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SettingsCalloutTone = 'default' | 'warn' | 'error' | 'success';

interface SettingsCalloutProps {
    icon?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    action?: ReactNode;
    tone?: SettingsCalloutTone;
    className?: string;
}

const toneStyles: Record<SettingsCalloutTone, { border: string; bg: string; iconBg: string; iconText: string }> = {
    default: {
        border: 'border-card-border',
        bg: 'bg-card',
        iconBg: 'bg-glass',
        iconText: 'text-stat-subtitle',
    },
    warn: {
        border: 'border-warning/40',
        bg: 'bg-warning/5',
        iconBg: 'bg-warning/15',
        iconText: 'text-warning',
    },
    error: {
        border: 'border-destructive/40',
        bg: 'bg-destructive/5',
        iconBg: 'bg-destructive/15',
        iconText: 'text-destructive',
    },
    success: {
        border: 'border-brand/40',
        bg: 'bg-brand/5',
        iconBg: 'bg-brand/15',
        iconText: 'text-brand',
    },
};

/**
 * Callout card matching the audit's set-a-2fa pattern: icon · stacked title+subtitle ·
 * trailing action button. Used for gating prompts (Set up 2FA, Activate license,
 * Configure SSO, empty-state CTAs).
 */
export function SettingsCallout({
    icon,
    title,
    subtitle,
    action,
    tone = 'default',
    className,
}: SettingsCalloutProps) {
    const styles = toneStyles[tone];
    return (
        <div
            className={cn(
                'flex items-center gap-4 rounded-md border px-4 py-3',
                styles.border,
                styles.bg,
                className,
            )}
        >
            {icon ? (
                <div
                    className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                        styles.iconBg,
                        styles.iconText,
                    )}
                >
                    {icon}
                </div>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-stat-value">
                    {title}
                </div>
                {subtitle ? (
                    <div className="text-[12.5px] leading-relaxed text-stat-subtitle">
                        {subtitle}
                    </div>
                ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}
