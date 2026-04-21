import type { VulnSeverity } from '@/types/security';

export const SEVERITY_ROW_TINT: Record<VulnSeverity, string> = {
  CRITICAL: 'bg-destructive/10 border-l-[3px] border-destructive/70',
  HIGH: 'bg-warning/10 border-l-[3px] border-warning/70',
  MEDIUM: 'border-l-[3px] border-info/40',
  LOW: 'border-l-[3px] border-transparent',
  UNKNOWN: 'border-l-[3px] border-transparent',
};
