import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SettingsFieldTone = 'default' | 'warn' | 'error' | 'success';

interface SettingsFieldProps {
    label: ReactNode;
    helper?: ReactNode;
    tone?: SettingsFieldTone;
    htmlFor?: string;
    children: ReactNode;
    align?: 'center' | 'start';
    className?: string;
}

const helperToneClass: Record<SettingsFieldTone, string> = {
    default: 'text-stat-subtitle',
    warn: 'text-warning',
    error: 'text-destructive',
    success: 'text-success',
};

/**
 * Two-column field row matching the audit's set-a-row pattern: label + mono helper on
 * the left, control on the right. Replaces the stacked label-then-input-then-paragraph
 * shadcn default. Use inside a <SettingsSection>.
 */
export function SettingsField({
    label,
    helper,
    tone = 'default',
    htmlFor,
    children,
    align = 'center',
    className,
}: SettingsFieldProps) {
    return (
        <div
            className={cn(
                'grid grid-cols-1 gap-[var(--density-cell-y,0.5rem)] py-[var(--density-row-y,0.75rem)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:gap-[var(--density-gap,1rem)]',
                align === 'center' ? 'md:items-center' : 'md:items-start',
                className,
            )}
        >
            <div className="flex flex-col gap-1 min-w-0">
                <label
                    htmlFor={htmlFor}
                    className="text-sm font-medium text-stat-value leading-snug"
                >
                    {label}
                </label>
                {helper ? (
                    <p
                        className={cn(
                            'text-sm leading-relaxed',
                            helperToneClass[tone],
                        )}
                    >
                        {helper}
                    </p>
                ) : null}
            </div>
            <div className="min-w-0">{children}</div>
        </div>
    );
}
