/**
 * Integration tests for per-service lifecycle routes:
 *   POST /api/stacks/:stackName/services/:serviceName/restart
 *   POST /api/stacks/:stackName/services/:serviceName/stop
 *   POST /api/stacks/:stackName/services/:serviceName/start
 *
 * Verifies permission gating, name validation, container filtering, fan-out
 * to the correct DockerController method, 404 paths, and error propagation.
 *
 * DockerController is mocked at the service layer so no real Docker daemon
 * is required. All other external dependencies are stubbed in kind.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { setupTestDb, cleanupTestDb, loginAsTestAdmin } from './helpers/setupTestDb';

// ── Hoisted mocks (must come before importing the app) ──────────────────────

const {
  mockGetContainersByStack,
  mockRestartContainer,
  mockStopContainer,
  mockStartContainer,
} = vi.hoisted(() => ({
  mockGetContainersByStack: vi.fn(),
  mockRestartContainer: vi.fn(),
  mockStopContainer: vi.fn(),
  mockStartContainer: vi.fn(),
}));

vi.mock('../services/DockerController', async () => {
  const actual = await vi.importActual<typeof import('../services/DockerController')>(
    '../services/DockerController',
  );
  return {
    ...actual,
    default: {
      ...actual.default,
      getInstance: () => ({
        getContainersByStack: mockGetContainersByStack,
        restartContainer: mockRestartContainer,
        stopContainer: mockStopContainer,
        startContainer: mockStartContainer,
      }),
    },
  };
});

vi.mock('../services/FileSystemService', () => ({
  FileSystemService: {
    getInstance: () => ({
      getStacks: vi.fn().mockResolvedValue([]),
      getBaseDir: () => '/tmp/compose',
      readComposeFile: vi.fn().mockResolvedValue(''),
    }),
  },
}));

// ── Container fixture helpers ───────────────────────────────────────────────

function makeContainer(id: string, service: string) {
  return {
    Id: id,
    Service: service,
    Names: [`/${service}`],
    State: 'running',
    Status: 'Up 1 second',
    Ports: [] as { PrivatePort: number; PublicPort: number }[],
  };
}

// ── Setup ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let app: import('express').Express;
let authCookie: string;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  ({ app } = await import('../index'));
  authCookie = await loginAsTestAdmin(app);
});

afterAll(() => {
  cleanupTestDb(tmpDir);
});

beforeEach(() => {
  mockGetContainersByStack.mockReset();
  mockRestartContainer.mockReset();
  mockStopContainer.mockReset();
  mockStartContainer.mockReset();

  // Default: operations resolve successfully
  mockRestartContainer.mockResolvedValue(undefined);
  mockStopContainer.mockResolvedValue(undefined);
  mockStartContainer.mockResolvedValue(undefined);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/stacks/:stackName/services/:serviceName/restart', () => {
  it('happy path: restarts matched container, ignores other services', async () => {
    const appContainer = makeContainer('container-app-1', 'app');
    const dbContainer = makeContainer('container-db-1', 'db');
    mockGetContainersByStack.mockResolvedValue([appContainer, dbContainer]);

    const res = await request(app)
      .post('/api/stacks/web/services/app/restart')
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);

    expect(mockRestartContainer).toHaveBeenCalledTimes(1);
    expect(mockRestartContainer).toHaveBeenCalledWith('container-app-1');
    expect(mockRestartContainer).not.toHaveBeenCalledWith('container-db-1');
  });
});

describe('POST /api/stacks/:stackName/services/:serviceName/stop', () => {
  it('happy path: stops matched container only', async () => {
    const appContainer = makeContainer('container-app-1', 'app');
    const dbContainer = makeContainer('container-db-1', 'db');
    mockGetContainersByStack.mockResolvedValue([appContainer, dbContainer]);

    const res = await request(app)
      .post('/api/stacks/web/services/app/stop')
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);

    expect(mockStopContainer).toHaveBeenCalledTimes(1);
    expect(mockStopContainer).toHaveBeenCalledWith('container-app-1');
    expect(mockStopContainer).not.toHaveBeenCalledWith('container-db-1');
  });
});

describe('POST /api/stacks/:stackName/services/:serviceName/start', () => {
  it('happy path: starts matched container only', async () => {
    const appContainer = makeContainer('container-app-1', 'app');
    const dbContainer = makeContainer('container-db-1', 'db');
    mockGetContainersByStack.mockResolvedValue([appContainer, dbContainer]);

    const res = await request(app)
      .post('/api/stacks/web/services/app/start')
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);

    expect(mockStartContainer).toHaveBeenCalledTimes(1);
    expect(mockStartContainer).toHaveBeenCalledWith('container-app-1');
    expect(mockStartContainer).not.toHaveBeenCalledWith('container-db-1');
  });
});

describe('multi-replica fan-out', () => {
  it('restarts all replicas when multiple containers share the same service name', async () => {
    const containers = [
      makeContainer('container-app-1', 'app'),
      makeContainer('container-app-2', 'app'),
      makeContainer('container-app-3', 'app'),
    ];
    mockGetContainersByStack.mockResolvedValue(containers);

    const res = await request(app)
      .post('/api/stacks/web/services/app/restart')
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(mockRestartContainer).toHaveBeenCalledTimes(3);
    expect(mockRestartContainer).toHaveBeenCalledWith('container-app-1');
    expect(mockRestartContainer).toHaveBeenCalledWith('container-app-2');
    expect(mockRestartContainer).toHaveBeenCalledWith('container-app-3');
  });
});

describe('404 error cases', () => {
  it('returns 404 when requested service is not in the stack', async () => {
    mockGetContainersByStack.mockResolvedValue([
      makeContainer('container-app-1', 'app'),
      makeContainer('container-db-1', 'db'),
    ]);

    const res = await request(app)
      .post('/api/stacks/web/services/nginx/restart')
      .set('Cookie', authCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Service 'nginx' not found in stack 'web'.");
    expect(mockRestartContainer).not.toHaveBeenCalled();
  });

  it('returns 404 when stack has no containers', async () => {
    mockGetContainersByStack.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/stacks/web/services/app/restart')
      .set('Cookie', authCookie);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('No containers found for this stack.');
    expect(mockRestartContainer).not.toHaveBeenCalled();
  });
});

describe('400 validation errors', () => {
  it('returns 400 for invalid stack name (path traversal)', async () => {
    // Express decodes %2F but a literal ".." fails isValidStackName
    const res = await request(app)
      .post('/api/stacks/..invalid../services/app/restart')
      .set('Cookie', authCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid stack name');
  });

  it('returns 400 for invalid service name (starts with hyphen)', async () => {
    const res = await request(app)
      .post('/api/stacks/web/services/-invalid/restart')
      .set('Cookie', authCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid service name');
  });
});

describe('authentication', () => {
  it('returns 401 when request has no auth cookie', async () => {
    const res = await request(app).post('/api/stacks/web/services/app/restart');
    expect(res.status).toBe(401);
  });
});

describe('Docker error propagation', () => {
  it('returns 500 with the error message when restartContainer rejects', async () => {
    mockGetContainersByStack.mockResolvedValue([makeContainer('container-app-1', 'app')]);
    mockRestartContainer.mockRejectedValue(new Error('daemon error'));

    const res = await request(app)
      .post('/api/stacks/web/services/app/restart')
      .set('Cookie', authCookie);

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).toContain('daemon error');
  });
});
