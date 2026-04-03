/**
 * Unit tests for SchedulerService — task execution, concurrent prevention,
 * license gating, cron parsing, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockGetDueScheduledTasks, mockCreateScheduledTaskRun, mockUpdateScheduledTaskRun,
  mockUpdateScheduledTask, mockCleanupOldTaskRuns, mockGetScheduledTask, mockGetNodes, mockGetNode,
  mockCreateSnapshot, mockInsertSnapshotFiles, mockClearStackUpdateStatus,
  mockGetTier, mockGetVariant,
  mockGetContainersByStack, mockRestartContainer, mockPruneSystem,
  mockUpdateStack,
  mockGetStacks, mockGetStackContent, mockGetEnvContent,
  mockCheckImage,
  mockDispatchAlert,
} = vi.hoisted(() => ({
  mockGetDueScheduledTasks: vi.fn().mockReturnValue([]),
  mockCreateScheduledTaskRun: vi.fn().mockReturnValue(1),
  mockUpdateScheduledTaskRun: vi.fn(),
  mockUpdateScheduledTask: vi.fn(),
  mockCleanupOldTaskRuns: vi.fn(),
  mockGetScheduledTask: vi.fn(),
  mockGetNodes: vi.fn().mockReturnValue([]),
  mockGetNode: vi.fn().mockReturnValue({ id: 1, name: 'local', type: 'local', status: 'online' }),
  mockCreateSnapshot: vi.fn().mockReturnValue(1),
  mockInsertSnapshotFiles: vi.fn(),
  mockClearStackUpdateStatus: vi.fn(),
  mockGetTier: vi.fn().mockReturnValue('pro'),
  mockGetVariant: vi.fn().mockReturnValue('team'),
  mockGetContainersByStack: vi.fn().mockResolvedValue([]),
  mockRestartContainer: vi.fn().mockResolvedValue(undefined),
  mockPruneSystem: vi.fn().mockResolvedValue({ success: true, reclaimedBytes: 0 }),
  mockUpdateStack: vi.fn().mockResolvedValue(undefined),
  mockGetStacks: vi.fn().mockResolvedValue([]),
  mockGetStackContent: vi.fn().mockResolvedValue(''),
  mockGetEnvContent: vi.fn().mockResolvedValue(''),
  mockCheckImage: vi.fn().mockResolvedValue(false),
  mockDispatchAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getDueScheduledTasks: mockGetDueScheduledTasks,
      createScheduledTaskRun: mockCreateScheduledTaskRun,
      updateScheduledTaskRun: mockUpdateScheduledTaskRun,
      updateScheduledTask: mockUpdateScheduledTask,
      cleanupOldTaskRuns: mockCleanupOldTaskRuns,
      getScheduledTask: mockGetScheduledTask,
      getNodes: mockGetNodes,
      getNode: mockGetNode,
      createSnapshot: mockCreateSnapshot,
      insertSnapshotFiles: mockInsertSnapshotFiles,
      clearStackUpdateStatus: mockClearStackUpdateStatus,
    }),
  },
}));

vi.mock('../services/LicenseService', () => ({
  LicenseService: {
    getInstance: () => ({
      getTier: mockGetTier,
      getVariant: mockGetVariant,
    }),
  },
}));

vi.mock('../services/DockerController', () => ({
  default: {
    getInstance: () => ({
      getContainersByStack: mockGetContainersByStack,
      restartContainer: mockRestartContainer,
      pruneSystem: mockPruneSystem,
    }),
  },
}));

vi.mock('../services/ComposeService', () => ({
  ComposeService: {
    getInstance: () => ({
      updateStack: mockUpdateStack,
    }),
  },
}));

vi.mock('../services/FileSystemService', () => ({
  FileSystemService: {
    getInstance: () => ({
      getStacks: mockGetStacks,
      getStackContent: mockGetStackContent,
      getEnvContent: mockGetEnvContent,
    }),
  },
}));

vi.mock('../services/ImageUpdateService', () => ({
  ImageUpdateService: {
    getInstance: () => ({
      checkImage: mockCheckImage,
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

vi.mock('../services/NodeRegistry', () => ({
  NodeRegistry: {
    getInstance: () => ({
      getDefaultNodeId: () => 1,
    }),
  },
}));

import { SchedulerService } from '../services/SchedulerService';

beforeEach(() => {
  vi.clearAllMocks();
  (SchedulerService as any).instance = undefined;
});

// ── calculateNextRun ───────────────────────────────────────────────────

describe('SchedulerService - calculateNextRun', () => {
  it('returns a future timestamp for valid cron expression', () => {
    const svc = SchedulerService.getInstance();
    const next = svc.calculateNextRun('*/5 * * * *'); // Every 5 minutes
    expect(next).toBeGreaterThan(Date.now());
  });

  it('throws on invalid cron expression', () => {
    const svc = SchedulerService.getInstance();
    expect(() => svc.calculateNextRun('not a cron')).toThrow();
  });
});

// ── License gating ─────────────────────────────────────────────────────

describe('SchedulerService - license gating', () => {
  function makeTask(overrides: Partial<any> = {}) {
    return {
      id: 1,
      name: 'test-task',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: 'my-stack',
      node_id: 1,
      created_by: 'admin',
      last_status: null,
      ...overrides,
    };
  }

  it('skips all tasks when tier is not pro', async () => {
    mockGetTier.mockReturnValue('community');
    mockGetDueScheduledTasks.mockReturnValue([makeTask()]);

    const svc = SchedulerService.getInstance();
    await (svc as any).tick();

    expect(mockCreateScheduledTaskRun).not.toHaveBeenCalled();
  });

  it('allows update tasks for non-admiral pro', async () => {
    mockGetTier.mockReturnValue('pro');
    mockGetVariant.mockReturnValue('individual');
    mockGetDueScheduledTasks.mockReturnValue([makeTask({ action: 'update' })]);
    mockGetContainersByStack.mockResolvedValue([{ Id: 'c1', Image: 'nginx:latest' }]);
    mockCheckImage.mockResolvedValue(false);

    const svc = SchedulerService.getInstance();
    await (svc as any).tick();

    // Wait for the async task to settle
    await new Promise(r => setTimeout(r, 50));
    expect(mockCreateScheduledTaskRun).toHaveBeenCalled();
  });

  it('skips non-update tasks for non-admiral pro', async () => {
    mockGetTier.mockReturnValue('pro');
    mockGetVariant.mockReturnValue('individual');
    mockGetDueScheduledTasks.mockReturnValue([makeTask({ action: 'restart' })]);

    const svc = SchedulerService.getInstance();
    await (svc as any).tick();

    expect(mockCreateScheduledTaskRun).not.toHaveBeenCalled();
  });

  it('allows all actions for admiral (pro + team)', async () => {
    mockGetTier.mockReturnValue('pro');
    mockGetVariant.mockReturnValue('team');
    mockGetDueScheduledTasks.mockReturnValue([makeTask({ action: 'restart' })]);
    mockGetContainersByStack.mockResolvedValue([{ Id: 'c1', Service: 'web' }]);

    const svc = SchedulerService.getInstance();
    await (svc as any).tick();

    await new Promise(r => setTimeout(r, 50));
    expect(mockCreateScheduledTaskRun).toHaveBeenCalled();
  });
});

// ── Concurrent task prevention ─────────────────────────────────────────

describe('SchedulerService - concurrent task prevention', () => {
  it('does not execute a task that is already in runningTasks', async () => {
    mockGetTier.mockReturnValue('pro');
    mockGetVariant.mockReturnValue('team');
    mockGetDueScheduledTasks.mockReturnValue([{
      id: 42,
      name: 'running-task',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: 'my-stack',
      node_id: 1,
      created_by: 'admin',
      last_status: null,
    }]);

    const svc = SchedulerService.getInstance();
    // Pre-add the task to runningTasks
    (svc as any).runningTasks.add(42);

    await (svc as any).tick();
    await new Promise(r => setTimeout(r, 50));

    expect(mockCreateScheduledTaskRun).not.toHaveBeenCalled();
  });

  it('removes task from runningTasks after completion', async () => {
    mockGetTier.mockReturnValue('pro');
    mockGetVariant.mockReturnValue('team');
    mockGetContainersByStack.mockResolvedValue([{ Id: 'c1', Service: 'web' }]);

    const svc = SchedulerService.getInstance();
    mockGetScheduledTask.mockReturnValue({
      id: 99,
      name: 'trigger-test',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: 'my-stack',
      node_id: 1,
      created_by: 'admin',
      last_status: null,
    });

    await svc.triggerTask(99);

    expect((svc as any).runningTasks.has(99)).toBe(false);
  });

  it('removes task from runningTasks even on failure', async () => {
    const svc = SchedulerService.getInstance();
    mockGetScheduledTask.mockReturnValue({
      id: 100,
      name: 'fail-test',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: null, // Will cause error: "requires target_id"
      node_id: null,
      created_by: 'admin',
      last_status: null,
    });

    await svc.triggerTask(100);

    expect((svc as any).runningTasks.has(100)).toBe(false);
    // Error should have been recorded
    expect(mockUpdateScheduledTaskRun).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ status: 'failure' })
    );
  });
});

// ── triggerTask ────────────────────────────────────────────────────────

describe('SchedulerService - triggerTask', () => {
  it('throws when task not found', async () => {
    mockGetScheduledTask.mockReturnValue(undefined);

    const svc = SchedulerService.getInstance();
    await expect(svc.triggerTask(999)).rejects.toThrow('Task not found');
  });

  it('throws when task is already running', async () => {
    mockGetScheduledTask.mockReturnValue({ id: 50, name: 'busy' });

    const svc = SchedulerService.getInstance();
    (svc as any).runningTasks.add(50);

    await expect(svc.triggerTask(50)).rejects.toThrow('already running');
  });

  it('sets triggered_by to manual', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 55,
      name: 'manual-test',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: false, // Disabled — but triggerTask should still work
      target_id: 'my-stack',
      node_id: 1,
      created_by: 'admin',
      last_status: null,
    });
    mockGetContainersByStack.mockResolvedValue([{ Id: 'c1', Service: 'web' }]);

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(55);

    expect(mockCreateScheduledTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({ triggered_by: 'manual' })
    );
  });
});

// ── executeRestart ─────────────────────────────────────────────────────

describe('SchedulerService - executeRestart', () => {
  it('restarts all containers in a stack', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 60,
      name: 'restart-all',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: 'my-stack',
      node_id: 1,
      created_by: 'admin',
      last_status: null,
    });
    mockGetContainersByStack.mockResolvedValue([
      { Id: 'c1', Service: 'web' },
      { Id: 'c2', Service: 'db' },
    ]);

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(60);

    expect(mockRestartContainer).toHaveBeenCalledTimes(2);
  });

  it('restarts only specified services when target_services set', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 61,
      name: 'restart-filtered',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: 'my-stack',
      node_id: 1,
      target_services: JSON.stringify(['web']),
      created_by: 'admin',
      last_status: null,
    });
    mockGetContainersByStack.mockResolvedValue([
      { Id: 'c1', Service: 'web' },
      { Id: 'c2', Service: 'db' },
    ]);

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(61);

    expect(mockRestartContainer).toHaveBeenCalledTimes(1);
    expect(mockRestartContainer).toHaveBeenCalledWith('c1');
  });

  it('records failure when no containers found', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 62,
      name: 'restart-empty',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: 'empty-stack',
      node_id: 1,
      created_by: 'admin',
      last_status: null,
    });
    mockGetContainersByStack.mockResolvedValue([]);

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(62);

    expect(mockUpdateScheduledTaskRun).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ status: 'failure', error: expect.stringContaining('No containers') })
    );
  });
});

// ── executePrune ───────────────────────────────────────────────────────

describe('SchedulerService - executePrune', () => {
  it('prunes all targets by default', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 70,
      name: 'prune-all',
      action: 'prune',
      cron_expression: '0 3 * * *',
      enabled: true,
      node_id: 1,
      created_by: 'admin',
      last_status: null,
    });

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(70);

    // Should prune all 4 targets
    expect(mockPruneSystem).toHaveBeenCalledTimes(4);
  });

  it('prunes only specified targets', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 71,
      name: 'prune-some',
      action: 'prune',
      cron_expression: '0 3 * * *',
      enabled: true,
      node_id: 1,
      prune_targets: JSON.stringify(['images', 'volumes']),
      created_by: 'admin',
      last_status: null,
    });

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(71);

    expect(mockPruneSystem).toHaveBeenCalledTimes(2);
    expect(mockPruneSystem).toHaveBeenCalledWith('images', undefined);
    expect(mockPruneSystem).toHaveBeenCalledWith('volumes', undefined);
  });

  it('includes label filter when configured', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 72,
      name: 'prune-labeled',
      action: 'prune',
      cron_expression: '0 3 * * *',
      enabled: true,
      node_id: 1,
      prune_targets: JSON.stringify(['containers']),
      prune_label_filter: 'env=staging',
      created_by: 'admin',
      last_status: null,
    });

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(72);

    expect(mockPruneSystem).toHaveBeenCalledWith('containers', 'env=staging');
  });
});

// ── executeUpdate ──────────────────────────────────────────────────────

describe('SchedulerService - executeUpdate', () => {
  it('updates stack when image update available', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 80,
      name: 'update-stack',
      action: 'update',
      cron_expression: '0 4 * * *',
      enabled: true,
      target_id: 'web-app',
      node_id: 1,
      created_by: 'admin',
      last_status: null,
    });
    mockGetContainersByStack.mockResolvedValue([
      { Id: 'c1', Image: 'nginx:latest' },
    ]);
    mockCheckImage.mockResolvedValue(true); // Update available

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(80);

    expect(mockUpdateStack).toHaveBeenCalledWith('web-app', undefined, true);
    expect(mockClearStackUpdateStatus).toHaveBeenCalledWith(1, 'web-app');
  });

  it('skips when all images up to date', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 81,
      name: 'update-no-change',
      action: 'update',
      cron_expression: '0 4 * * *',
      enabled: true,
      target_id: 'web-app',
      node_id: 1,
      created_by: 'admin',
      last_status: null,
    });
    mockGetContainersByStack.mockResolvedValue([
      { Id: 'c1', Image: 'nginx:latest' },
    ]);
    mockCheckImage.mockResolvedValue(false); // No update

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(81);

    expect(mockUpdateStack).not.toHaveBeenCalled();
  });

  it('handles wildcard target (*) by updating all stacks', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 82,
      name: 'update-all',
      action: 'update',
      cron_expression: '0 4 * * *',
      enabled: true,
      target_id: '*',
      node_id: 1,
      created_by: 'admin',
      last_status: null,
    });
    mockGetStacks.mockResolvedValue(['app1', 'app2']);
    mockGetContainersByStack.mockResolvedValue([
      { Id: 'c1', Image: 'nginx:latest' },
    ]);
    mockCheckImage.mockResolvedValue(true);

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(82);

    expect(mockUpdateStack).toHaveBeenCalledTimes(2);
  });
});

// ── Error handling & notifications ─────────────────────────────────────

describe('SchedulerService - error handling', () => {
  it('records failure status in DB on error', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 90,
      name: 'error-task',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: null,
      node_id: null,
      created_by: 'admin',
      last_status: null,
    });

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(90);

    expect(mockUpdateScheduledTask).toHaveBeenCalledWith(
      90,
      expect.objectContaining({ last_status: 'failure' })
    );
  });

  it('dispatches error notification on failure', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 91,
      name: 'notify-fail',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: null,
      node_id: null,
      created_by: 'admin',
      last_status: null,
    });

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(91);

    expect(mockDispatchAlert).toHaveBeenCalledWith('error', expect.stringContaining('failed'), undefined);
  });

  it('dispatches recovery notification when previous status was failure', async () => {
    mockGetScheduledTask.mockReturnValue({
      id: 92,
      name: 'recovery-task',
      action: 'restart',
      cron_expression: '*/5 * * * *',
      enabled: true,
      target_id: 'my-stack',
      node_id: 1,
      created_by: 'admin',
      last_status: 'failure', // Previous run failed
    });
    mockGetContainersByStack.mockResolvedValue([{ Id: 'c1', Service: 'web' }]);

    const svc = SchedulerService.getInstance();
    await svc.triggerTask(92);

    expect(mockDispatchAlert).toHaveBeenCalledWith('info', expect.stringContaining('recovered'), 'my-stack');
  });
});

// ── Cleanup ────────────────────────────────────────────────────────────

describe('SchedulerService - cleanup', () => {
  it('calls cleanupOldTaskRuns(30) on every tick', async () => {
    mockGetTier.mockReturnValue('pro');
    mockGetVariant.mockReturnValue('team');
    mockGetDueScheduledTasks.mockReturnValue([]);

    const svc = SchedulerService.getInstance();
    await (svc as any).tick();

    expect(mockCleanupOldTaskRuns).toHaveBeenCalledWith(30);
  });
});

// ── isProcessing guard ─────────────────────────────────────────────────

describe('SchedulerService - isProcessing guard', () => {
  it('skips tick if already processing', async () => {
    mockGetTier.mockReturnValue('pro');

    const svc = SchedulerService.getInstance();
    (svc as any).isProcessing = true;

    await (svc as any).tick();

    expect(mockGetTier).not.toHaveBeenCalled();
  });

  it('resets isProcessing after tick completes (even on error)', async () => {
    mockGetTier.mockImplementationOnce(() => { throw new Error('boom'); });

    const svc = SchedulerService.getInstance();
    await (svc as any).tick();

    expect((svc as any).isProcessing).toBe(false);
  });
});
