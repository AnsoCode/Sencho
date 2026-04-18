export interface TemplateEnv {
  name: string;
  label?: string;
  default?: string;
}

export interface TemplateVolume {
  container?: string;
  bind?: string;
}

export type ScanStatus = 'clean' | 'vulnerable' | 'unscanned';

export interface Template {
  type?: number;
  title: string;
  description: string;
  logo?: string;
  image?: string;
  ports?: string[];
  volumes?: TemplateVolume[];
  env?: TemplateEnv[];
  categories?: string[];
  github_url?: string;
  docs_url?: string;
  architectures?: string[];
  stars?: number;
  source?: string;
  scan_status?: ScanStatus;
  scan_cve_count?: number;
  scan_critical_count?: number;
  scan_high_count?: number;
  featured?: boolean;
}
