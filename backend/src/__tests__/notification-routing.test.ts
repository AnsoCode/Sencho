/**
 * Unit tests for Notification Routing — CRUD operations on notification_routes,
 * routing logic in NotificationService, and edge cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockGetEnabledNotificationRoutes,
  mockGetEnabledAgents,
  mockAddNotificationHistory,
} = vi.hoisted(() => ({
  mockGetEnabledNotificationRoutes: vi.fn().mockReturnValue([]),
  mockGetEnabledAgents: vi.fn().mockReturnValue([]),
  mockAddNotificationHistory: vi.fn().mockReturnValue({
    id: 1,
    level: 'info',
    message: 'test',
    timestamp: Date.now(),
    is_read: 0,
  }),
}));

vi.mock('../services/DatabaseService', () => ({
  DatabaseService: {
    getInstance: () => ({
      getEnabledNotificationRoutes: mockGetEnabledNotificationRoutes,
      getEnabledAgents: mockGetEnabledAgents,
      addNotificationHistory: mockAddNotificationHistory,
    }),
  },
}));

// Spy on global fetch for webhook dispatch verification
const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

import { NotificationService } from '../services/NotificationService';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Prod Discord',
    stack_patterns: ['my-app'],
    channel_type: 'discord' as const,
    channel_url: 'https://discord.com/api/webhooks/123/abc',
    priority: 0,
    enabled: true,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function makeAgent(type: 'discord' | 'slack' | 'webhook' = 'slack') {
  return {
    id: 1,
    type,
    url: 'https://hooks.slack.com/services/global',
    enabled: true,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('NotificationService - routing logic', () => {
  let svc: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton so each test gets a fresh instance
    (NotificationService as any).instance = undefined;
    svc = NotificationService.getInstance();
  });

  it('routes to matching route channel and skips global agents', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([makeRoute()]);
    mockGetEnabledAgents.mockReturnValue([makeAgent()]);

    await svc.dispatchAlert('error', 'Container crashed', 'my-app');

    // Should have called fetch with discord webhook URL
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/abc',
      expect.objectContaining({ method: 'POST' })
    );
    // Should NOT have called the global slack agent
    expect(mockFetch).not.toHaveBeenCalledWith(
      'https://hooks.slack.com/services/global',
      expect.anything()
    );
  });

  it('falls back to global agents when no route matches', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([
      makeRoute({ stack_patterns: ['other-stack'] }),
    ]);
    mockGetEnabledAgents.mockReturnValue([makeAgent()]);

    await svc.dispatchAlert('error', 'Container crashed', 'my-app');

    // Should NOT have called the route's discord channel
    expect(mockFetch).not.toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/abc',
      expect.anything()
    );
    // Should have called global slack agent as fallback
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/global',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('falls back to global agents when no stackName provided', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([makeRoute()]);
    mockGetEnabledAgents.mockReturnValue([makeAgent()]);

    await svc.dispatchAlert('warning', 'Host CPU high');

    // Should have called global agent (no stackName means skip routing)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/global',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('respects priority ordering — first match wins', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([
      makeRoute({ id: 1, name: 'High priority', priority: 0, stack_patterns: ['my-app'], channel_url: 'https://discord.com/api/webhooks/first' }),
      makeRoute({ id: 2, name: 'Low priority', priority: 10, stack_patterns: ['my-app'], channel_url: 'https://discord.com/api/webhooks/second' }),
    ]);
    mockGetEnabledAgents.mockReturnValue([]);

    await svc.dispatchAlert('error', 'Test', 'my-app');

    // Both routes match, both should be dispatched (all matching routes fire)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/first',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/second',
      expect.objectContaining({ method: 'POST' })
    );
    // Global agents should still be skipped since routes matched
    expect(mockGetEnabledAgents).not.toHaveBeenCalled();
  });

  it('skips routes that do not match the stack', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([
      makeRoute({ stack_patterns: ['staging-app'] }),
    ]);
    mockGetEnabledAgents.mockReturnValue([makeAgent()]);

    await svc.dispatchAlert('error', 'Test', 'production-app');

    // Route should not fire
    expect(mockFetch).not.toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/abc',
      expect.anything()
    );
    // Global agent should fire as fallback
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/global',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('handles multiple stack patterns in a single route', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([
      makeRoute({ stack_patterns: ['app-a', 'app-b', 'app-c'] }),
    ]);
    mockGetEnabledAgents.mockReturnValue([]);

    await svc.dispatchAlert('info', 'Update complete', 'app-b');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/abc',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('gracefully handles fetch errors in route dispatch without crashing', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([makeRoute()]);
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

    // Should not throw
    await expect(svc.dispatchAlert('error', 'Crash', 'my-app')).resolves.toBeUndefined();
  });

  it('does not dispatch to global agents when routes array is empty and no stackName', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([]);
    mockGetEnabledAgents.mockReturnValue([]);

    await svc.dispatchAlert('info', 'Test');

    // No routes, no agents — just logs and broadcasts
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('always logs to history regardless of routing', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([]);
    mockGetEnabledAgents.mockReturnValue([]);

    await svc.dispatchAlert('info', 'Should be logged');

    expect(mockAddNotificationHistory).toHaveBeenCalledWith({
      level: 'info',
      message: 'Should be logged',
      timestamp: expect.any(Number),
    });
  });

  it('dispatches to slack channel type correctly via route', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([
      makeRoute({ channel_type: 'slack', channel_url: 'https://hooks.slack.com/services/route-specific' }),
    ]);

    await svc.dispatchAlert('warning', 'Alert', 'my-app');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/route-specific',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Alert'),
      })
    );
  });

  it('dispatches to webhook channel type correctly via route', async () => {
    mockGetEnabledNotificationRoutes.mockReturnValue([
      makeRoute({ channel_type: 'webhook', channel_url: 'https://example.com/hook' }),
    ]);

    await svc.dispatchAlert('error', 'Critical failure', 'my-app');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Critical failure'),
      })
    );
  });
});
