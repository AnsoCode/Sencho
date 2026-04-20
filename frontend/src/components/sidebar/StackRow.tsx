import type { ReactNode } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import { Cursor, CursorContainer, CursorFollow, CursorProvider } from '@/components/animate-ui/primitives/animate/cursor';
import { LabelDot } from '@/components/LabelPill';
import type { Label } from '@/components/label-types';
import { cn } from '@/lib/utils';
import { sidebarRowActive, sidebarRowBase } from './sidebar-styles';

export type StackRowStatus = 'running' | 'exited' | 'unknown';

interface StackRowProps {
  file: string;
  displayName: string;
  status: StackRowStatus;
  isBusy: boolean;
  isActive: boolean;
  isPaid: boolean;
  labels: Label[];
  hasUpdate: boolean;
  hasGitPending: boolean;
  onSelect: (file: string) => void;
  kebabSlot: ReactNode;
}

function statusText(status: StackRowStatus): string {
  if (status === 'running') return 'UP';
  if (status === 'exited') return 'DN';
  return '--';
}

function statusColor(status: StackRowStatus, isBusy: boolean): string {
  if (isBusy) return 'text-muted-foreground';
  if (status === 'running') return 'text-success';
  if (status === 'exited') return 'text-destructive';
  return 'text-stat-icon';
}

function RowTooltip({ trigger, label }: { trigger: ReactNode; label: string }) {
  return (
    <CursorProvider>
      <CursorContainer className="inline-flex items-center shrink-0">{trigger}</CursorContainer>
      <Cursor><div className="h-2 w-2 rounded-full bg-brand" /></Cursor>
      <CursorFollow side="bottom" sideOffset={4} align="center" transition={{ stiffness: 400, damping: 40, bounce: 0 }}>
        <div className="rounded-md border border-card-border bg-popover/95 backdrop-blur-[10px] backdrop-saturate-[1.15] px-2.5 py-1.5 shadow-md">
          <span className="font-mono text-xs tabular-nums text-stat-value">{label}</span>
        </div>
      </CursorFollow>
    </CursorProvider>
  );
}

export function StackRow(props: StackRowProps) {
  const { file, displayName, status, isBusy, isActive, isPaid, labels, hasUpdate, hasGitPending, onSelect, kebabSlot } = props;

  return (
    <div
      data-testid="stack-row"
      role="button"
      tabIndex={0}
      className={cn(sidebarRowBase, isActive && sidebarRowActive)}
      onClick={() => onSelect(file)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(file); } }}
    >
      <span className={cn('font-mono text-[10px] shrink-0 w-[22px] flex items-center', statusColor(status, isBusy))}>
        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} /> : statusText(status)}
      </span>
      <span className="flex-1 truncate font-mono text-[13px]">{displayName}</span>
      {isPaid && labels.length > 0 && (
        <span className="flex items-center gap-0.5 shrink-0">
          {labels.map(l => <LabelDot key={l.id} color={l.color} />)}
        </span>
      )}
      {hasUpdate && (
        <RowTooltip
          trigger={<span className="w-2 h-2 rounded-full bg-info animate-pulse" />}
          label="Update available"
        />
      )}
      {hasGitPending && (
        <RowTooltip
          trigger={<GitBranch className="w-3 h-3 text-brand" strokeWidth={1.5} />}
          label="Git source update pending"
        />
      )}
      <div
        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {kebabSlot}
      </div>
    </div>
  );
}
