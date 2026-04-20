import * as React from 'react';
import { cn } from '@/lib/utils';

interface AuthStepHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  kicker: string;
  hero: string;
  caption?: React.ReactNode;
}

export function AuthStepHeader({ kicker, hero, caption, className, ...props }: AuthStepHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-stat-subtitle">
        {kicker}
      </span>
      <h1 className="font-display text-[2.25rem] italic leading-[1.05] text-stat-value">
        {hero}
      </h1>
      {caption && (
        <p className="text-sm leading-snug text-stat-subtitle">{caption}</p>
      )}
    </div>
  );
}
