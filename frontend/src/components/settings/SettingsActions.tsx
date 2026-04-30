import { forwardRef, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SettingsActionsProps {
    children: ReactNode;
    hint?: ReactNode;
    align?: 'end' | 'between';
    className?: string;
}

/**
 * Action row matching the audit's set-a-cta: secondary outline + cyan-filled primary,
 * always in that order (left to right). The optional `hint` slot puts a mono micro-fact
 * on the left (e.g. "DEPLOYS TO local"); pass `align="between"` to use it.
 */
export function SettingsActions({ children, hint, align = 'end', className }: SettingsActionsProps) {
    return (
        <div
            className={cn(
                'flex flex-wrap items-center gap-2 pt-4',
                align === 'between' ? 'justify-between' : 'justify-end',
                className,
            )}
        >
            {hint ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-stat-subtitle">
                    {hint}
                </span>
            ) : null}
            <div className="flex items-center gap-2">{children}</div>
        </div>
    );
}

export const SettingsPrimaryButton = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, ...props }, ref) => (
        <Button
            ref={ref}
            {...props}
            className={cn(
                'bg-brand text-brand-foreground shadow-btn-glow hover:bg-brand/90',
                className,
            )}
        />
    ),
);
SettingsPrimaryButton.displayName = 'SettingsPrimaryButton';

export const SettingsSecondaryButton = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, ...props }, ref) => (
        <Button
            ref={ref}
            variant={variant ?? 'outline'}
            {...props}
            className={cn(className)}
        />
    ),
);
SettingsSecondaryButton.displayName = 'SettingsSecondaryButton';

