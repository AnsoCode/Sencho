import * as React from 'react';
import { cn } from '@/lib/utils';

interface TogglePillProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (next: boolean) => void;
}

const TogglePill = React.forwardRef<HTMLButtonElement, TogglePillProps>(
  ({ checked, onChange, className, disabled, onClick, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          onChange(!checked);
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-md border px-2.5 py-1 font-mono text-xs uppercase tracking-[0.18em] transition-colors min-w-[60px] focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          checked
            ? 'border-success/30 bg-success/10 text-success hover:bg-success/15'
            : 'border-card-border bg-card text-stat-subtitle hover:text-stat-value',
          className,
        )}
        {...props}
      >
        {checked ? 'ON' : 'OFF'}
      </button>
    );
  },
);
TogglePill.displayName = 'TogglePill';

export { TogglePill };
export type { TogglePillProps };
