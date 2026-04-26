import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { ParsedLogRow, LogStage } from './composeLogParser';

interface StructuredLogRowProps {
  row: ParsedLogRow;
}

const BADGE_CLASSES: Record<LogStage, string> = {
  PULL:   'bg-blue-500/10 text-blue-400',
  BUILD:  'bg-violet-500/10 text-violet-400',
  CREATE: 'bg-brand/10 text-brand',
  START:  'bg-success/10 text-success',
  STOP:   'bg-warning/10 text-warning',
  DOWN:   'bg-muted/60 text-muted-foreground',
  WARN:   'bg-warning/10 text-warning',
  ERR:    'bg-destructive/10 text-destructive',
  LOG:    'bg-muted/30 text-muted-foreground/70',
};

function StructuredLogRowBase({ row }: StructuredLogRowProps) {
  const isError = row.level === 'error';
  const isWarn = row.level === 'warn';

  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-0.5 text-xs font-mono relative overflow-hidden',
        isError && 'bg-destructive/5 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-destructive/60',
        isWarn && 'bg-warning/5',
      )}
    >
      <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums w-[88px] pt-[1px]">
        {row.timestamp.substring(11, 19)}
      </span>
      <span
        className={cn(
          'text-[10px] uppercase tracking-widest shrink-0 w-[52px] text-center rounded px-1 pt-[1px]',
          BADGE_CLASSES[row.stage],
        )}
      >
        {row.stage}
      </span>
      <span className={cn('flex-1 break-all leading-4', isError ? 'text-destructive/90' : 'text-foreground/90')}>
        {row.message}
      </span>
    </div>
  );
}

export const StructuredLogRow = memo(StructuredLogRowBase);
export default StructuredLogRow;
