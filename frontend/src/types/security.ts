export type VulnSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type VulnScanStatus = 'in_progress' | 'completed' | 'failed';
export type VulnScanTrigger = 'manual' | 'scheduled' | 'deploy';

export type TrivySource = 'managed' | 'host' | 'none';

export interface TrivyStatus {
  available: boolean;
  version: string | null;
  source: TrivySource;
  autoUpdate: boolean;
  busy: boolean;
}

export interface TrivyUpdateCheck {
  current: string | null;
  latest: string;
  updateAvailable: boolean;
  source: TrivySource;
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
  suppressed?: boolean;
  suppression_id?: number;
  suppression_reason?: string;
}

export interface CveSuppression {
  id: number;
  cve_id: string;
  pkg_name: string | null;
  image_pattern: string | null;
  reason: string;
  created_by: string;
  created_at: number;
  expires_at: number | null;
  replicated_from_control: number;
  active: boolean;
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
  node_identity: string;
  stack_pattern: string | null;
  max_severity: VulnSeverity;
  block_on_deploy: number;
  enabled: number;
  replicated_from_control: number;
  created_at: number;
  updated_at: number;
}

export type FleetRole = 'control' | 'replica';

export interface ScanCompareVulnerability {
  vulnerability_id: string;
  pkg_name: string;
  severity: VulnSeverity;
  installed_version?: string;
  fixed_version?: string | null;
  primary_url?: string | null;
  suppressed?: boolean;
  suppression_id?: number;
  suppression_reason?: string;
}

export interface ScanCompareResult {
  scanA: { id: number; scanned_at: number; image_ref: string };
  scanB: { id: number; scanned_at: number; image_ref: string };
  added: ScanCompareVulnerability[];
  removed: ScanCompareVulnerability[];
  unchanged: ScanCompareVulnerability[];
}
