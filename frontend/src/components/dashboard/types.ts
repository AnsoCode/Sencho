export interface Stats {
  active: number;
  managed: number;
  unmanaged: number;
  exited: number;
  total: number;
}

export interface SystemStats {
  cpu: {
    usage: string;
    cores: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: string;
  };
  disk: {
    fs: string;
    mount: string;
    total: number;
    used: number;
    free: number;
    usagePercent: string;
  } | null;
  network?: {
    rxBytes: number;
    txBytes: number;
    rxSec: number;
    txSec: number;
  };
}

export interface MetricPoint {
  container_id: string;
  stack_name: string;
  timestamp: number;
  cpu_percent: number;
  memory_mb: number;
  net_rx_mb: number;
  net_tx_mb: number;
}

export interface NotificationItem {
  id: number;
  level: 'info' | 'warning' | 'error';
  message: string;
  timestamp: number;
  is_read: boolean;
}

export interface StackStatusEntry {
  status: 'running' | 'exited' | 'unknown';
  mainPort?: number;
}

export type HealthLevel = 'healthy' | 'degraded' | 'critical';

export interface DashboardData {
  stats: Stats;
  systemStats: SystemStats | null;
  metrics: MetricPoint[];
  stackStatuses: Record<string, StackStatusEntry>;
  notifications: NotificationItem[];
  lastUpdated: number;
}
