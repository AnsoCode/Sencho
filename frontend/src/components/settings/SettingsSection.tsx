import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SettingsSectionProps {
    title: string;
    kicker?: ReactNode;
    description?: ReactNode;
    children: ReactNode;
    className?: string;
}

/**
 * Mono-uppercase section header (PASSWORD, SESSIONS, THRESHOLDS) with a hairline rule
 * underneath, matching the audit's set-a-section pattern. Children render in a stack
 * with hairline dividers, typically SettingsField rows.
 */
export function SettingsSection({ title, kicker, description, children, className }: SettingsSectionProps) {
    return (
        <section className={cn('flex flex-col', className)}>
            <header className="flex items-baseline justify-between gap-3 pb-[var(--density-cell-y,0.5rem)]">
                <h3 className="font-mono text-[10px] leading-3 uppercase tracking-[0.18em] text-stat-subtitle">
                    {title}
                </h3>
                {kicker ? (
                    <span className="font-mono text-[10px] leading-3 uppercase tracking-[0.18em] text-stat-subtitle/70">
                        {kicker}
                    </span>
                ) : null}
            </header>
            <div className="border-t border-border/60" />
            {description ? (
                <p className="pt-3 text-sm leading-relaxed text-stat-subtitle">
                    {description}
                </p>
            ) : null}
            <div className="flex flex-col divide-y divide-border/40">{children}</div>
        </section>
    );
}
