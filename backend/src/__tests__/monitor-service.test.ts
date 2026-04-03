/**
 * Unit tests for MonitorService — alert state machine, metric calculations,
 * cleanup delegation, global settings evaluation, and concurrency guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const { mockGetGlobalSettings, mockGetNodes, mockGetStackAlerts, mockAddContainerMetric,
  mockCleanupOldMetrics, mockCleanupOldNotifications, mockCleanupOldAuditLogs,
  mockUpdateStackAlertLastFired, mockGetSystemState, mockSetSystemState,
  mockGetRunningContainers, mockGetAllContainers, mockGetContainerStatsStream,
  mockDispatchAlert,
  mockCurrentLoad, mockMem, mockFsSize,
  mockExecAsync,
} = vi.hoisted(() => ({
  mockGetGlobalSettings: vi.fn().mockReturnValue({}),
  mockGetNodes: vi.fn().mockReturnValue([]),
  mockGetStackAlerts: vi.fn().mockReturnValue([]),
  mockAddContainerMetric: vi.fn(),
  mockCleanupOldMetrics: vi.fn(),
  mockCleanupOldNotifications: vi.fn(),
  mockCleanupOldAuditLogs: vi.fn(),
  mockUpdateStackAlertLastFired: vi.fn(),
  mockGetSystemState: vi.fn().mockReturnValue(null),
  mockSetSystemState: vi.fn(),
  mockGetRunningContainers: vi.fn().mockResolvedValue([]),
  mockGetAllContainers: vi.fn().mockResolvedValue([]),
  mockGetContainerStatsStream: vi.fn().mockResolvedValue('{}'),
  mockDispatchAlert: vi.fn().mockResolvedValue(undefined),
  mockCurrentLoad: vi.fn().mockResolvedValue({ currentLoad: 10 }),
  mockMem: vi.fn().mockResolvedValue({ used: 4e9, total: 16e9 }),
  mockFsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 30 }]),
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '' }),
}));

vi.mock('../services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getGlobalSettings: mockGetGlobalSettings,
      getNodes: mockGetNodes,
      getStackAlerts: mockGetStackAlerts,
      addContainerMetric: mockAddContainerMetric,
      cleanupOldMetrics: mockCleanupOldMetrics,
      cleanupOldNotifications: mockCleanupOldNotifications,
      cleanupOldAuditLogs: mockCleanupOldAuditLogs,
      updateStackAlertLastFired: mockUpdateStackAlertLastFired,
      getSystemState: mockGetSystemState,
      setSystemState: mockSetSystemState,
    }),
  },
}));

vi.mock('../services/DockerController', () => ({
  default: {
    getInstance: () => ({
      getRunningContainers: mockGetRunningContainers,
      getAllContainers: mockGetAllContainers,
      getContainerStatsStream: mockGetContainerStatsStream,
    }),
  },
}));

vi.mock('../services/NotificationService', () => ({
  NotificationService: {
    getInstance: () => ({
      dispatchAlert: mockDispatchAlert,
    }),
  },
}));

vi.mock('systeminformation', () => ({
  default: {
    currentLoad: (...args: unknown[]) => mockCurrentLoad(...args),
    mem: (...args: unknown[]) => mockMem(...args),
    fsSize: (...args: unknown[]) => mockFsSize(...args),
  },
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: () => mockExecAsync,
}));

import { MonitorService } from '../services/MonitorService';

beforeEach(() => {
  vi.clearAllMocks();
  (MonitorService as any).instance = undefined;
});

// ── Pure calculation helpers (accessed via private method reflection) ───

describe('MonitorService - calculateCpuPercent', () => {
  function calcCpu(stats: any): number {
    const svc = MonitorService.getInstance();
    return (svc as any).calculateCpuPercent(stats);
  }

  it('returns correct percentage for normal stats', () => {
    const stats = {
      cpu_stats: { cpu_usage: { total_usage: 2000 }, system_cpu_usage: 10000, online_cpus: 4 },
      precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 5000 },
    };
    // (1000 / 5000) * 4 * 100 = 80%
    expect(calcCpu(stats)).toBeCloseTo(80, 1);
  });

  it('returns 0 when cpu_stats is missing', () => {
    expect(calcCpu({})).toBe(0);
    expect(calcCpu(null)).toBe(0);
    expect(calcCpu({ cpu_stats: {} })).toBe(0);
  });

  it('returns 0 when systemDelta is zero', () => {
    const stats = {
      cpu_stats: { cpu_usage: { total_usage: 2000 }, system_cpu_usage: 5000, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 5000 },
    };
    expect(calcCpu(stats)).toBe(0);
  });

  it('accounts for online_cpus count', () => {
    const stats = {
      cpu_stats: { cpu_usage: { total_usage: 2000 }, system_cpu_usage: 10000, online_cpus: 8 },
      precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 5000 },
    };
    // (1000/5000) * 8 * 100 = 160%
    expect(calcCpu(stats)).toBeCloseTo(160, 1);
  });

  it('falls back to percpu_usage length when online_cpus missing', () => {
    const stats = {
      cpu_stats: { cpu_usage: { total_usage: 2000, percpu_usage: [0, 0] }, system_cpu_usage: 10000 },
      precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 5000 },
    };
    // (1000/5000) * 2 * 100 = 40%
    expect(calcCpu(stats)).toBeCloseTo(40, 1);
  });
});

describe('MonitorService - calculateMemoryPercent', () => {
  function calcMem(stats: any): number {
    const svc = MonitorService.getInstance();
    return (svc as any).calculateMemoryPercent(stats);
  }

  it('returns correct percentage subtracting cache', () => {
    const stats = {
      memory_stats: { usage: 500e6, limit: 1e9, stats: { cache: 100e6 } },
    };
    // (400e6 / 1e9) * 100 = 40%
    expect(calcMem(stats)).toBeCloseTo(40, 1);
  });

  it('returns 0 when memory_stats is missing', () => {
    expect(calcMem({})).toBe(0);
    expect(calcMem({ memory_stats: {} })).toBe(0);
  });

  it('returns 0 when limit is zero', () => {
    const stats = { memory_stats: { usage: 100, limit: 0 } };
    expect(calcMem(stats)).toBe(0);
  });

  it('handles missing cache field', () => {
    const stats = { memory_stats: { usage: 500e6, limit: 1e9 } };
    // No cache → (500e6 / 1e9) * 100 = 50%
    expect(calcMem(stats)).toBeCloseTo(50, 1);
  });
});

describe('MonitorService - calculateNetwork', () => {
  function calcNet(stats: any, dir: 'rx' | 'tx'): number {
    const svc = MonitorService.getInstance();
    return (svc as any).calculateNetwork(stats, dir);
  }

  it('sums rx_bytes across all interfaces', () => {
    const stats = {
      networks: {
        eth0: { rx_bytes: 1024 * 1024, tx_bytes: 0 },
        eth1: { rx_bytes: 2 * 1024 * 1024, tx_bytes: 0 },
      },
    };
    expect(calcNet(stats, 'rx')).toBeCloseTo(3, 0); // 3 MB
  });

  it('sums tx_bytes across all interfaces', () => {
    const stats = {
      networks: {
        eth0: { rx_bytes: 0, tx_bytes: 512 * 1024 },
      },
    };
    expect(calcNet(stats, 'tx')).toBeCloseTo(0.5, 1); // 0.5 MB
  });

  it('returns 0 when no networks present', () => {
    expect(calcNet({}, 'rx')).toBe(0);
    expect(calcNet({ networks: null }, 'tx')).toBe(0);
  });
});

describe('MonitorService - evaluateCondition', () => {
  function evalCond(actual: number, operator: string, threshold: number): boolean {
    const svc = MonitorService.getInstance();
    return (svc as any).evaluateCondition(actual, operator, threshold);
  }

  it('handles > operator', () => {
    expect(evalCond(81, '>', 80)).toBe(true);
    expect(evalCond(80, '>', 80)).toBe(false);
  });

  it('handles < operator', () => {
    expect(evalCond(79, '<', 80)).toBe(true);
    expect(evalCond(80, '<', 80)).toBe(false);
  });

  it('handles >= operator at boundary', () => {
    expect(evalCond(80, '>=', 80)).toBe(true);
    expect(evalCond(79, '>=', 80)).toBe(false);
  });

  it('handles <= operator at boundary', () => {
    expect(evalCond(80, '<=', 80)).toBe(true);
    expect(evalCond(81, '<=', 80)).toBe(false);
  });

  it('handles == operator', () => {
    expect(evalCond(80, '==', 80)).toBe(true);
    expect(evalCond(81, '==', 80)).toBe(false);
  });

  it('returns false for unknown operator', () => {
    expect(evalCond(80, '!=', 80)).toBe(false);
    expect(evalCond(80, 'foo', 80)).toBe(false);
  });
});

// ── Integration-level: evaluateGlobalSettings ──────────────────────────

describe('MonitorService - evaluateGlobalSettings', () => {
  it('dispatches CPU warning when over threshold', async () => {
    mockGetGlobalSettings.mockReturnValue({ host_cpu_limit: '50' });
    mockCurrentLoad.mockResolvedValue({ currentLoad: 75 });

    const svc = MonitorService.getInstance();
    await (svc as any).evaluateGlobalSettings({ host_cpu_limit: '50' });

    expect(mockDispatchAlert).toHaveBeenCalledWith('warning', expect.stringContaining('CPU'));
  });

  it('does not dispatch when CPU below threshold', async () => {
    mockCurrentLoad.mockResolvedValue({ currentLoad: 25 });

    const svc = MonitorService.getInstance();
    await (svc as any).evaluateGlobalSettings({ host_cpu_limit: '50' });

    expect(mockDispatchAlert).not.toHaveBeenCalledWith('warning', expect.stringContaining('CPU'));
  });

  it('dispatches RAM warning when over threshold', async () => {
    mockMem.mockResolvedValue({ used: 15e9, total: 16e9 }); // ~94%

    const svc = MonitorService.getInstance();
    await (svc as any).evaluateGlobalSettings({ host_ram_limit: '80' });

    expect(mockDispatchAlert).toHaveBeenCalledWith('warning', expect.stringContaining('Memory'));
  });

  it('dispatches disk warning when over threshold', async () => {
    mockFsSize.mockResolvedValue([{ mount: '/', use: 92 }]);

    const svc = MonitorService.getInstance();
    await (svc as any).evaluateGlobalSettings({ host_disk_limit: '90' });

    expect(mockDispatchAlert).toHaveBeenCalledWith('warning', expect.stringContaining('Disk'));
  });

  it('skips host limits when threshold is 0 or NaN', async () => {
    mockCurrentLoad.mockResolvedValue({ currentLoad: 99 });

    const svc = MonitorService.getInstance();
    await (svc as any).evaluateGlobalSettings({ host_cpu_limit: '0' });
    expect(mockDispatchAlert).not.toHaveBeenCalledWith('warning', expect.stringContaining('CPU'));

    await (svc as any).evaluateGlobalSettings({ host_cpu_limit: 'abc' });
    expect(mockDispatchAlert).not.toHaveBeenCalledWith('warning', expect.stringContaining('CPU'));
  });
});

// ── Global crash detection ─────────────────────────────────────────────

describe('MonitorService - global crash detection', () => {
  it('detects exited containers with non-intentional exit codes', async () => {
    mockGetNodes.mockReturnValue([{ id: 1, name: 'local', type: 'local' }]);
    mockGetAllContainers.mockResolvedValue([{
      State: 'exited',
      Status: 'Exited (1) 5 seconds ago',
      Names: ['/my-container'],
    }]);

    const svc = MonitorService.getInstance();
    await (svc as any).evaluateGlobalSettings({ global_crash: '1' });

    expect(mockDispatchAlert).toHaveBeenCalledWith('error', expect.stringContaining('Crash'), undefined);
  });

  it('ignores exit codes 0, 137, 143, 255', async () => {
    mockGetNodes.mockReturnValue([{ id: 1, name: 'local', type: 'local' }]);
    const intentionalExits = [0, 137, 143, 255];

    for (const code of intentionalExits) {
      mockDispatchAlert.mockClear();
      mockGetAllContainers.mockResolvedValue([{
        State: 'exited',
        Status: `Exited (${code}) 5 seconds ago`,
        Names: ['/safe-container'],
      }]);

      const svc = MonitorService.getInstance();
      (MonitorService as any).instance = undefined;
      await (svc as any).evaluateGlobalSettings({ global_crash: '1' });
      expect(mockDispatchAlert).not.toHaveBeenCalledWith('error', expect.stringContaining('Crash'));
    }
  });

  it('detects unhealthy containers', async () => {
    mockGetNodes.mockReturnValue([{ id: 1, name: 'local', type: 'local' }]);
    mockGetAllContainers.mockResolvedValue([{
      State: 'running',
      Status: 'Up 2 hours (unhealthy)',
      Names: ['/sick-container'],
    }]);

    const svc = MonitorService.getInstance();
    await (svc as any).evaluateGlobalSettings({ global_crash: '1' });

    expect(mockDispatchAlert).toHaveBeenCalledWith('error', expect.stringContaining('unhealthy'), undefined);
  });

  it('skips remote nodes', async () => {
    mockGetNodes.mockReturnValue([{ id: 2, name: 'remote-node', type: 'remote' }]);

    const svc = MonitorService.getInstance();
    await (svc as any).evaluateGlobalSettings({ global_crash: '1' });

    expect(mockGetAllContainers).not.toHaveBeenCalled();
  });
});

// ── Alert breach state machine ─────────────────────────────────────────

describe('MonitorService - breach state machine', () => {
  function setupAlertScenario(cpuPercent: number) {
    mockGetNodes.mockReturnValue([{ id: 1, name: 'local', type: 'local' }]);
    mockGetRunningContainers.mockResolvedValue([{
      Id: 'c1',
      Labels: { 'com.docker.compose.project': 'my-stack' },
    }]);
    mockGetContainerStatsStream.mockResolvedValue(JSON.stringify({
      cpu_stats: { cpu_usage: { total_usage: 1000 + cpuPercent * 50 }, system_cpu_usage: 10000, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 5000 },
      memory_stats: { usage: 100e6, limit: 1e9 },
    }));
    mockGetStackAlerts.mockReturnValue([{
      id: 1,
      stack_name: 'my-stack',
      metric: 'cpu_percent',
      operator: '>',
      threshold: 80,
      duration_mins: 0, // Fire immediately on breach
      cooldown_mins: 60,
      last_fired_at: 0,
    }]);
    mockGetGlobalSettings.mockReturnValue({});
  }

  it('fires alert when condition met and duration is 0', async () => {
    setupAlertScenario(90); // Will produce CPU > 80%

    const svc = MonitorService.getInstance();
    await (svc as any).evaluate();

    expect(mockDispatchAlert).toHaveBeenCalledWith('warning', expect.stringContaining('CPU'), 'my-stack');
    expect(mockUpdateStackAlertLastFired).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it('does not fire when condition not met', async () => {
    setupAlertScenario(10); // Will produce CPU < 80%

    const svc = MonitorService.getInstance();
    await (svc as any).evaluate();

    expect(mockDispatchAlert).not.toHaveBeenCalledWith('warning', expect.stringContaining('CPU'));
  });

  it('respects cooldown after firing', async () => {
    setupAlertScenario(90);
    // Simulate that alert was fired 30 minutes ago (within 60-min cooldown)
    mockGetStackAlerts.mockReturnValue([{
      id: 1,
      stack_name: 'my-stack',
      metric: 'cpu_percent',
      operator: '>',
      threshold: 80,
      duration_mins: 0,
      cooldown_mins: 60,
      last_fired_at: Date.now() - 30 * 60 * 1000,
    }]);

    const svc = MonitorService.getInstance();
    await (svc as any).evaluate();

    expect(mockUpdateStackAlertLastFired).not.toHaveBeenCalled();
  });

  it('resets breach state when condition clears', async () => {
    const svc = MonitorService.getInstance();

    // First: breach starts
    setupAlertScenario(90);
    mockGetStackAlerts.mockReturnValue([{
      id: 42,
      stack_name: 'my-stack',
      metric: 'cpu_percent',
      operator: '>',
      threshold: 80,
      duration_mins: 999, // Won't fire due to long duration
      cooldown_mins: 0,
      last_fired_at: 0,
    }]);
    await (svc as any).evaluate();
    expect((svc as any).activeBreaches.has(42)).toBe(true);

    // Second: condition clears
    setupAlertScenario(10);
    mockGetStackAlerts.mockReturnValue([{
      id: 42,
      stack_name: 'my-stack',
      metric: 'cpu_percent',
      operator: '>',
      threshold: 80,
      duration_mins: 999,
      cooldown_mins: 0,
      last_fired_at: 0,
    }]);
    await (svc as any).evaluate();
    expect((svc as any).activeBreaches.has(42)).toBe(false);
  });
});

// ── Cleanup triggers ───────────────────────────────────────────────────

describe('MonitorService - cleanup triggers', () => {
  it('calls cleanup methods with configured retention', async () => {
    mockGetNodes.mockReturnValue([]);
    mockGetStackAlerts.mockReturnValue([]);
    mockGetGlobalSettings.mockReturnValue({
      metrics_retention_hours: '48',
      log_retention_days: '7',
      audit_retention_days: '30',
    });

    const svc = MonitorService.getInstance();
    await (svc as any).evaluate();

    expect(mockCleanupOldMetrics).toHaveBeenCalledWith(48);
    expect(mockCleanupOldNotifications).toHaveBeenCalledWith(7);
    expect(mockCleanupOldAuditLogs).toHaveBeenCalledWith(30);
  });

  it('uses defaults when settings are NaN', async () => {
    mockGetNodes.mockReturnValue([]);
    mockGetStackAlerts.mockReturnValue([]);
    mockGetGlobalSettings.mockReturnValue({
      metrics_retention_hours: 'bad',
      log_retention_days: 'bad',
      audit_retention_days: 'bad',
    });

    const svc = MonitorService.getInstance();
    await (svc as any).evaluate();

    expect(mockCleanupOldMetrics).toHaveBeenCalledWith(24);
    expect(mockCleanupOldNotifications).toHaveBeenCalledWith(30);
    expect(mockCleanupOldAuditLogs).toHaveBeenCalledWith(90);
  });
});

// ── isProcessing guard ─────────────────────────────────────────────────

describe('MonitorService - isProcessing guard', () => {
  it('skips evaluation if already processing', async () => {
    mockGetGlobalSettings.mockReturnValue({});
    mockGetNodes.mockReturnValue([]);
    mockGetStackAlerts.mockReturnValue([]);

    const svc = MonitorService.getInstance();
    (svc as any).isProcessing = true;

    await (svc as any).evaluate();

    // Should have been skipped — no DB calls
    expect(mockGetGlobalSettings).not.toHaveBeenCalled();
  });

  it('resets isProcessing after evaluate completes (even on error)', async () => {
    mockGetGlobalSettings.mockImplementationOnce(() => { throw new Error('boom'); });

    const svc = MonitorService.getInstance();
    await (svc as any).evaluate();

    // isProcessing should be reset in finally block
    expect((svc as any).isProcessing).toBe(false);
  });
});
