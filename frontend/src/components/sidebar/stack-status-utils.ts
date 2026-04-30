export type StackRowStatus = 'running' | 'exited' | 'unknown';

export function statusText(status: StackRowStatus): string {
  if (status === 'running') return 'UP';
  if (status === 'exited') return 'DN';
  return '--';
}

export function statusColor(status: StackRowStatus, isBusy: boolean): string {
  if (isBusy) return 'text-muted-foreground';
  if (status === 'running') return 'text-success';
  if (status === 'exited') return 'text-destructive';
  return 'text-stat-icon';
}
