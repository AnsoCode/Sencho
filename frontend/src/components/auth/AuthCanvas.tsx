import * as React from 'react';
import { cn } from '@/lib/utils';

interface AuthCanvasProps extends React.HTMLAttributes<HTMLDivElement> {
  footer?: React.ReactNode;
}

export function AuthCanvas({ children, className, footer, ...props }: AuthCanvasProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-svh flex-col items-center justify-center px-4 py-10 sm:px-6',
        className,
      )}
      {...props}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_at_50%_-10%,oklch(0.78_0.11_195_/_0.10),transparent_55%)]"
      />

      <div
        role="group"
        className="relative w-full max-w-[440px] animate-scale-in overflow-hidden rounded-lg border border-card-border border-t-card-border-top bg-card text-card-foreground shadow-card-bevel"
        style={{ animationDuration: 'var(--duration-base)', animationTimingFunction: 'var(--ease-out-expo)' }}
      >
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-brand/70" />

        <div className="flex items-center justify-between border-b border-card-border/60 px-7 pt-6 pb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-stat-subtitle">
            SENCHO
          </span>
          <span className="h-1.5 w-1.5 rounded-full bg-brand shadow-[0_0_8px_0_oklch(0.78_0.11_195_/_0.6)]" />
        </div>

        <div className="px-7 pb-7 pt-6">{children}</div>

        {footer && (
          <div className="border-t border-card-border/60 px-7 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
