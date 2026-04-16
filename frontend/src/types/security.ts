export type VulnSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type VulnScanStatus = 'in_progress' | 'completed' | 'failed';
export type VulnScanTrigger = 'manual' | 'scheduled' | 'deploy';

export interface TrivyStatus {
  available: boolean;
  version: string | null;
}

export interface VulnerabilityScan {
  id: number;
  node_id: number;
  image_ref: string;
  image_digest: string | null;
  scanned_at: number;
  total_vulnerabilities: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  unknown_count: number;
  fixable_count: number;
  highest_severity: VulnSeverity | null;
  os_info: string | null;
  trivy_version: string | null;
  scan_duration_ms: number | null;
  triggered_by: VulnScanTrigger;
  status: VulnScanStatus;
  error: string | null;
  stack_context: string | null;
}

export interface VulnerabilityDetail {
  id: number;
  scan_id: number;
  vulnerability_id: string;
  pkg_name: string;
  installed_version: string;
  fixed_version: string | null;
  severity: VulnSeverity;
  title: string | null;
  description: string | null;
  primary_url: string | null;
}

export interface ScanSummary {
  image_ref: string;
  highest_severity: VulnSeverity | null;
  scanned_at: number;
  scan_id: number;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  fixable: number;
}

export interface ScanPolicy {
  id: number;
  name: string;
  node_id: number | null;
  stack_pattern: string | null;
  max_severity: VulnSeverity;
  block_on_deploy: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}
