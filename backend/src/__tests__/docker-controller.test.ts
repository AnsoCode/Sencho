/**
 * Unit tests for DockerController — validateApiData, state-safe container ops,
 * disk usage, classified resources, orphan detection, and error paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const { mockDocker } = vi.hoisted(() => {
  const mockDocker = {
    df: vi.fn(),
    listImages: vi.fn().mockResolvedValue([]),
    listVolumes: vi.fn().mockResolvedValue({ Volumes: [] }),
    listNetworks: vi.fn().mockResolvedValue([]),
    listContainers: vi.fn().mockResolvedValue([]),
    getContainer: vi.fn(),
    getImage: vi.fn(),
    getVolume: vi.fn(),
    getNetwork: vi.fn(),
    pruneContainers: vi.fn().mockResolvedValue({ SpaceReclaimed: 0 }),
    pruneImages: vi.fn().mockResolvedValue({ SpaceReclaimed: 0 }),
    pruneNetworks: vi.fn().mockResolvedValue({}),
    pruneVolumes: vi.fn().mockResolvedValue({ SpaceReclaimed: 0 }),
  };
  return { mockDocker };
});

vi.mock('../services/NodeRegistry', () => ({
  NodeRegistry: {
    getInstance: () => ({
      getDocker: () => mockDocker,
      getDefaultNodeId: () => 1,
    }),
  },
}));

// Prevent COMPOSE_DIR related issues
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('util', () => ({
  promisify: () => vi.fn(),
}));

import DockerController from '../services/DockerController';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── validateApiData ────────────────────────────────────────────────────

describe('DockerController - validateApiData', () => {
  it('throws when response is a string (HTML from wrong port)', async () => {
    mockDocker.listImages.mockResolvedValue('<html>Not Docker</html>');

    const dc = DockerController.getInstance(1);
    await expect(dc.getImages()).rejects.toThrow('Invalid response from Docker API');
  });

  it('passes through valid object data', async () => {
    const imageData = [{ Id: 'sha256:abc', RepoTags: ['nginx:latest'], Size: 100 }];
    mockDocker.listImages.mockResolvedValue(imageData);

    const dc = DockerController.getInstance(1);
    const result = await dc.getImages();
    expect(result).toEqual(imageData);
  });
});

// ── State-safe container operations ────────────────────────────────────

describe('DockerController - startContainer', () => {
  it('starts a container successfully', async () => {
    const mockStart = vi.fn().mockResolvedValue(undefined);
    mockDocker.getContainer.mockReturnValue({ start: mockStart });

    const dc = DockerController.getInstance(1);
    await dc.startContainer('abc123');

    expect(mockStart).toHaveBeenCalled();
  });

  it('silently ignores 304 already-started error', async () => {
    const mockStart = vi.fn().mockRejectedValue({ statusCode: 304 });
    mockDocker.getContainer.mockReturnValue({ start: mockStart });

    const dc = DockerController.getInstance(1);
    await expect(dc.startContainer('abc123')).resolves.toBeUndefined();
  });

  it('rethrows other errors', async () => {
    const mockStart = vi.fn().mockRejectedValue(new Error('container not found'));
    mockDocker.getContainer.mockReturnValue({ start: mockStart });

    const dc = DockerController.getInstance(1);
    await expect(dc.startContainer('abc123')).rejects.toThrow('container not found');
  });
});

describe('DockerController - stopContainer', () => {
  it('stops a container successfully', async () => {
    const mockStop = vi.fn().mockResolvedValue(undefined);
    mockDocker.getContainer.mockReturnValue({ stop: mockStop });

    const dc = DockerController.getInstance(1);
    await dc.stopContainer('abc123');

    expect(mockStop).toHaveBeenCalled();
  });

  it('silently ignores 304 already-stopped error', async () => {
    const mockStop = vi.fn().mockRejectedValue({ statusCode: 304 });
    mockDocker.getContainer.mockReturnValue({ stop: mockStop });

    const dc = DockerController.getInstance(1);
    await expect(dc.stopContainer('abc123')).resolves.toBeUndefined();
  });

  it('rethrows other errors', async () => {
    const err = new Error('permission denied');
    const mockStop = vi.fn().mockRejectedValue(err);
    mockDocker.getContainer.mockReturnValue({ stop: mockStop });

    const dc = DockerController.getInstance(1);
    await expect(dc.stopContainer('abc123')).rejects.toThrow('permission denied');
  });
});

// ── removeContainers ───────────────────────────────────────────────────

describe('DockerController - removeContainers', () => {
  it('removes multiple containers and returns results', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    mockDocker.getContainer.mockReturnValue({ remove: mockRemove });

    const dc = DockerController.getInstance(1);
    const results = await dc.removeContainers(['c1', 'c2']);

    expect(results).toEqual([
      { id: 'c1', success: true },
      { id: 'c2', success: true },
    ]);
  });

  it('returns failure result for containers that cannot be removed', async () => {
    let callCount = 0;
    mockDocker.getContainer.mockImplementation(() => ({
      remove: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) throw new Error('in use');
        return Promise.resolve();
      }),
    }));

    const dc = DockerController.getInstance(1);
    const results = await dc.removeContainers(['c1', 'c2']);

    expect(results[0]).toEqual({ id: 'c1', success: true });
    expect(results[1]).toMatchObject({ id: 'c2', success: false, error: 'in use' });
  });
});

// ── getDiskUsage ───────────────────────────────────────────────────────

describe('DockerController - getDiskUsage', () => {
  it('calculates reclaimable space correctly', async () => {
    mockDocker.df.mockResolvedValue({
      Images: [
        { Id: 'img1', Containers: 0, Size: 500 },       // reclaimable (unused)
        { Id: 'img2', Containers: 1, Size: 300 },       // not reclaimable (in use)
      ],
      Containers: [
        { State: 'running', SizeRw: 100 },              // not reclaimable (running)
        { State: 'exited', SizeRw: 200 },                // reclaimable (stopped)
      ],
      Volumes: [
        { UsageData: { RefCount: 0, Size: 400 } },      // reclaimable (unused)
        { UsageData: { RefCount: 1, Size: 300 } },      // not reclaimable (in use)
      ],
    });

    const dc = DockerController.getInstance(1);
    const usage = await dc.getDiskUsage();

    expect(usage.reclaimableImages).toBe(500);
    expect(usage.reclaimableContainers).toBe(200);
    expect(usage.reclaimableVolumes).toBe(400);
  });

  it('handles empty arrays gracefully', async () => {
    mockDocker.df.mockResolvedValue({
      Images: [],
      Containers: [],
      Volumes: [],
    });

    const dc = DockerController.getInstance(1);
    const usage = await dc.getDiskUsage();

    expect(usage.reclaimableImages).toBe(0);
    expect(usage.reclaimableContainers).toBe(0);
    expect(usage.reclaimableVolumes).toBe(0);
  });

  it('handles missing fields gracefully', async () => {
    mockDocker.df.mockResolvedValue({});

    const dc = DockerController.getInstance(1);
    const usage = await dc.getDiskUsage();

    expect(usage.reclaimableImages).toBe(0);
    expect(usage.reclaimableContainers).toBe(0);
    expect(usage.reclaimableVolumes).toBe(0);
  });
});

// ── pruneSystem ────────────────────────────────────────────────────────

describe('DockerController - pruneSystem', () => {
  it('prunes containers and returns reclaimed bytes', async () => {
    mockDocker.pruneContainers.mockResolvedValue({ SpaceReclaimed: 1024 });

    const dc = DockerController.getInstance(1);
    const result = await dc.pruneSystem('containers');

    expect(result).toEqual({ success: true, reclaimedBytes: 1024 });
  });

  it('prunes images with dangling false filter', async () => {
    mockDocker.pruneImages.mockResolvedValue({ SpaceReclaimed: 2048 });

    const dc = DockerController.getInstance(1);
    await dc.pruneSystem('images');

    expect(mockDocker.pruneImages).toHaveBeenCalledWith({
      filters: expect.objectContaining({ dangling: { 'false': true } }),
    });
  });

  it('includes label filter when provided', async () => {
    mockDocker.pruneContainers.mockResolvedValue({ SpaceReclaimed: 0 });

    const dc = DockerController.getInstance(1);
    await dc.pruneSystem('containers', 'com.example=true');

    expect(mockDocker.pruneContainers).toHaveBeenCalledWith({
      filters: { label: ['com.example=true'] },
    });
  });

  it('prunes volumes with all true filter', async () => {
    mockDocker.pruneVolumes.mockResolvedValue({ SpaceReclaimed: 4096 });

    const dc = DockerController.getInstance(1);
    await dc.pruneSystem('volumes');

    expect(mockDocker.pruneVolumes).toHaveBeenCalledWith({
      filters: { all: ['true'] },
    });
  });
});

// ── getClassifiedResources ─────────────────────────────────────────────

describe('DockerController - getClassifiedResources', () => {
  it('classifies managed and unmanaged images', async () => {
    mockDocker.listImages.mockResolvedValue([
      { Id: 'img1', RepoTags: ['nginx:latest'], Size: 100, Containers: 1 },
      { Id: 'img2', RepoTags: ['redis:latest'], Size: 200, Containers: 1 },
      { Id: 'img3', RepoTags: ['old:v1'], Size: 50, Containers: 0 },
    ]);
    mockDocker.listContainers.mockResolvedValue([
      { ImageID: 'img1', Labels: { 'com.docker.compose.project': 'my-stack' } },
      { ImageID: 'img2', Labels: { 'com.docker.compose.project': 'unknown-stack' } },
    ]);
    mockDocker.listVolumes.mockResolvedValue({ Volumes: [] });
    mockDocker.listNetworks.mockResolvedValue([]);

    const dc = DockerController.getInstance(1);
    const result = await dc.getClassifiedResources(['my-stack']);

    const managed = result.images.find(i => i.Id === 'img1');
    expect(managed!.managedStatus).toBe('managed');
    expect(managed!.managedBy).toBe('my-stack');

    const unmanaged = result.images.find(i => i.Id === 'img2');
    expect(unmanaged!.managedStatus).toBe('unmanaged');

    const unused = result.images.find(i => i.Id === 'img3');
    expect(unused!.managedStatus).toBe('unused');
  });

  it('classifies system networks', async () => {
    mockDocker.listImages.mockResolvedValue([]);
    mockDocker.listContainers.mockResolvedValue([]);
    mockDocker.listVolumes.mockResolvedValue({ Volumes: [] });
    mockDocker.listNetworks.mockResolvedValue([
      { Id: 'n1', Name: 'bridge', Driver: 'bridge', Scope: 'local' },
      { Id: 'n2', Name: 'host', Driver: 'host', Scope: 'local' },
      { Id: 'n3', Name: 'none', Driver: 'null', Scope: 'local' },
      { Id: 'n4', Name: 'my-stack_default', Driver: 'bridge', Scope: 'local', Labels: { 'com.docker.compose.project': 'my-stack' } },
    ]);

    const dc = DockerController.getInstance(1);
    const result = await dc.getClassifiedResources(['my-stack']);

    expect(result.networks.filter(n => n.managedStatus === 'system')).toHaveLength(3);
    expect(result.networks.find(n => n.Name === 'my-stack_default')!.managedStatus).toBe('managed');
  });

  it('classifies managed and unmanaged volumes', async () => {
    mockDocker.listImages.mockResolvedValue([]);
    mockDocker.listContainers.mockResolvedValue([]);
    mockDocker.listNetworks.mockResolvedValue([]);
    mockDocker.listVolumes.mockResolvedValue({
      Volumes: [
        { Name: 'my-stack_data', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/my-stack_data', Labels: { 'com.docker.compose.project': 'my-stack' } },
        { Name: 'random_vol', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/random', Labels: {} },
      ],
    });

    const dc = DockerController.getInstance(1);
    const result = await dc.getClassifiedResources(['my-stack']);

    expect(result.volumes.find(v => v.Name === 'my-stack_data')!.managedStatus).toBe('managed');
    expect(result.volumes.find(v => v.Name === 'random_vol')!.managedStatus).toBe('unmanaged');
  });
});

// ── getOrphanContainers ────────────────────────────────────────────────

describe('DockerController - getOrphanContainers', () => {
  it('returns containers whose project label is not in known stacks', async () => {
    mockDocker.listContainers.mockResolvedValue([
      { Id: 'c1', Names: ['/c1'], State: 'running', Status: 'Up', Image: 'nginx', Labels: { 'com.docker.compose.project': 'orphan-stack' } },
      { Id: 'c2', Names: ['/c2'], State: 'running', Status: 'Up', Image: 'redis', Labels: { 'com.docker.compose.project': 'known-stack' } },
    ]);

    const dc = DockerController.getInstance(1);
    const result = await dc.getOrphanContainers(['known-stack']);

    expect(result['orphan-stack']).toHaveLength(1);
    expect(result['orphan-stack'][0].Id).toBe('c1');
    expect(result['known-stack']).toBeUndefined();
  });

  it('returns empty when all containers belong to known stacks', async () => {
    mockDocker.listContainers.mockResolvedValue([
      { Id: 'c1', Names: ['/c1'], State: 'running', Status: 'Up', Image: 'nginx', Labels: { 'com.docker.compose.project': 'my-stack' } },
    ]);

    const dc = DockerController.getInstance(1);
    const result = await dc.getOrphanContainers(['my-stack']);

    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ── Docker daemon unreachable ──────────────────────────────────────────

describe('DockerController - error paths', () => {
  it('propagates connection errors from Docker daemon', async () => {
    mockDocker.listContainers.mockRejectedValue(
      new Error('connect ECONNREFUSED /var/run/docker.sock')
    );

    const dc = DockerController.getInstance(1);
    await expect(dc.getOrphanContainers(['x'])).rejects.toThrow('ECONNREFUSED');
  });

  it('propagates errors from df() call', async () => {
    mockDocker.df.mockRejectedValue(new Error('daemon not running'));

    const dc = DockerController.getInstance(1);
    await expect(dc.getDiskUsage()).rejects.toThrow('daemon not running');
  });
});
