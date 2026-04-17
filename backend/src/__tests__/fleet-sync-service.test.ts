/**
 * Unit tests for FleetSyncService: the service that replicates security
 * configuration from a control Sencho instance to every registered remote.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetNodes,
  mockGetNode,
  mockGetScanPolicies,
  mockReplaceReplicatedScanPolicies,
  mockRecordFleetSyncSuccess,
  mockRecordFleetSyncFailure,
  mockGetSystemState,
  mockSetSystemState,
  mockAxiosPost,
} = vi.hoisted(() => ({
  mockGetNodes: vi.fn().mockReturnValue([]),
  mockGetNode: vi.fn(),
  mockGetScanPolicies: vi.fn().mockReturnValue([]),
  mockReplaceReplicatedScanPolicies: vi.fn(),
  mockRecordFleetSyncSuccess: vi.fn(),
  mockRecordFleetSyncFailure: vi.fn(),
  mockGetSystemState: vi.fn().mockReturnValue(null),
  mockSetSystemState: vi.fn(),
  mockAxiosPost: vi.fn().mockResolvedValue({ data: { success: true } }),
}));

vi.mock('../services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getNodes: mockGetNodes,
      getScanPolicies: mockGetScanPolicies,
      replaceReplicatedScanPolicies: mockReplaceReplicatedScanPolicies,
      recordFleetSyncSuccess: mockRecordFleetSyncSuccess,
      recordFleetSyncFailure: mockRecordFleetSyncFailure,
      getSystemState: mockGetSystemState,
      setSystemState: mockSetSystemState,
    }),
  },
}));

vi.mock('../services/NodeRegistry', () => ({
  NodeRegistry: {
    getInstance: () => ({
      getNode: mockGetNode,
    }),
  },
}));

vi.mock('axios', () => ({
  default: { post: mockAxiosPost },
  AxiosError: class AxiosError extends Error {
    response?: { status: number; statusText: string; data: unknown };
  },
}));

import { FleetSyncService, LOCAL_IDENTITY_SENTINEL } from '../services/FleetSyncService';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSystemState.mockReturnValue(null);
});

describe('FleetSyncService.getRole', () => {
  it('returns control when no fleet_role is set in system_state', () => {
    mockGetSystemState.mockReturnValue(null);
    expect(FleetSyncService.getRole()).toBe('control');
  });

  it('returns replica when fleet_role system_state is "replica"', () => {
    mockGetSystemState.mockImplementation((key: string) => (key === 'fleet_role' ? 'replica' : null));
    expect(FleetSyncService.getRole()).toBe('replica');
  });
});

describe('FleetSyncService.getSelfIdentity', () => {
  it('returns LOCAL_IDENTITY_SENTINEL on control nodes', () => {
    mockGetSystemState.mockReturnValue(null);
    expect(FleetSyncService.getSelfIdentity()).toBe(LOCAL_IDENTITY_SENTINEL);
  });

  it('returns the cached target identity on replicas', () => {
    mockGetSystemState.mockImplementation((key: string) => {
      if (key === 'fleet_role') return 'replica';
      if (key === 'fleet_self_identity') return 'https://sencho.example.com';
      return null;
    });
    expect(FleetSyncService.getSelfIdentity()).toBe('https://sencho.example.com');
  });
});

describe('FleetSyncService.resolveIdentityForNodeId', () => {
  it('returns empty string when nodeId is null (fleet-wide policy)', () => {
    expect(FleetSyncService.resolveIdentityForNodeId(null)).toBe('');
  });

  it('returns LOCAL_IDENTITY_SENTINEL when the node is local', () => {
    mockGetNode.mockReturnValue({ id: 1, type: 'local', api_url: '', api_token: '' });
    expect(FleetSyncService.resolveIdentityForNodeId(1)).toBe(LOCAL_IDENTITY_SENTINEL);
  });

  it('returns the remote api_url for remote nodes', () => {
    mockGetNode.mockReturnValue({ id: 2, type: 'remote', api_url: 'https://remote.example.com', api_token: 'tok' });
    expect(FleetSyncService.resolveIdentityForNodeId(2)).toBe('https://remote.example.com');
  });
});

describe('FleetSyncService.pushResource', () => {
  it('does not push when this instance is a replica', async () => {
    mockGetSystemState.mockImplementation((key: string) => (key === 'fleet_role' ? 'replica' : null));
    await FleetSyncService.getInstance().pushResource('scan_policies');
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('skips nodes without api_url or api_token', async () => {
    mockGetNodes.mockReturnValue([
      { id: 1, type: 'local', api_url: '', api_token: '' },
      { id: 2, type: 'remote', api_url: '', api_token: 'tok' },
      { id: 3, type: 'remote', api_url: 'https://good.example', api_token: '' },
    ]);
    await FleetSyncService.getInstance().pushResource('scan_policies');
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('pushes to every configured remote with local rows only', async () => {
    mockGetNodes.mockReturnValue([
      { id: 2, type: 'remote', api_url: 'https://a.example', api_token: 'tokA', name: 'A' },
      { id: 3, type: 'remote', api_url: 'https://b.example', api_token: 'tokB', name: 'B' },
    ]);
    mockGetScanPolicies.mockReturnValue([
      { id: 1, name: 'local-1', node_identity: '', replicated_from_control: 0, created_at: 1, updated_at: 1 },
      { id: 2, name: 'mirrored', node_identity: 'https://somewhere', replicated_from_control: 1, created_at: 1, updated_at: 1 },
    ]);
    await FleetSyncService.getInstance().pushResource('scan_policies');

    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
    const firstCall = mockAxiosPost.mock.calls[0];
    expect(firstCall[0]).toBe('https://a.example/api/fleet/sync/scan_policies');
    expect(firstCall[1].rows).toHaveLength(1);
    expect(firstCall[1].rows[0].name).toBe('local-1');
    expect(firstCall[1].targetIdentity).toBe('https://a.example');
    expect(firstCall[2].headers.Authorization).toBe('Bearer tokA');
    expect(mockRecordFleetSyncSuccess).toHaveBeenCalledWith(2, 'scan_policies');
    expect(mockRecordFleetSyncSuccess).toHaveBeenCalledWith(3, 'scan_policies');
  });

  it('records per-node failure without throwing when one remote errors', async () => {
    mockGetNodes.mockReturnValue([
      { id: 2, type: 'remote', api_url: 'https://fail.example', api_token: 'tok', name: 'fail' },
      { id: 3, type: 'remote', api_url: 'https://ok.example', api_token: 'tok2', name: 'ok' },
    ]);
    mockAxiosPost.mockImplementation((url: string) => {
      if (url.includes('fail.example')) return Promise.reject(new Error('network error'));
      return Promise.resolve({ data: { success: true } });
    });
    await expect(FleetSyncService.getInstance().pushResource('scan_policies')).resolves.not.toThrow();
    expect(mockRecordFleetSyncFailure).toHaveBeenCalledWith(2, 'scan_policies', expect.stringContaining('network error'));
    expect(mockRecordFleetSyncSuccess).toHaveBeenCalledWith(3, 'scan_policies');
  });
});

describe('FleetSyncService.applyIncomingSync', () => {
  it('promotes this instance to replica and caches target identity', () => {
    const rows = [{
      id: 0, name: 'from-control', node_id: null, node_identity: '',
      stack_pattern: null, max_severity: 'CRITICAL' as const,
      block_on_deploy: 0, enabled: 1, replicated_from_control: 1,
      created_at: 1, updated_at: 1,
    }];
    FleetSyncService.getInstance().applyIncomingSync('scan_policies', rows, 'https://me.example');
    expect(mockSetSystemState).toHaveBeenCalledWith('fleet_role', 'replica');
    expect(mockSetSystemState).toHaveBeenCalledWith('fleet_self_identity', 'https://me.example');
    expect(mockReplaceReplicatedScanPolicies).toHaveBeenCalledWith(rows);
  });

  it('skips identity caching when targetIdentity is empty', () => {
    FleetSyncService.getInstance().applyIncomingSync('scan_policies', [], '');
    expect(mockSetSystemState).toHaveBeenCalledWith('fleet_role', 'replica');
    expect(mockSetSystemState).not.toHaveBeenCalledWith('fleet_self_identity', expect.anything());
  });
});
