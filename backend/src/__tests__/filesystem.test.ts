/**
 * Unit tests for FileSystemService.deleteStack() including the
 * Docker-based fallback for permission-denied scenarios.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { EventEmitter } from 'events';

const { mockSpawn, mockRm, mockRmdir } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockRm: vi.fn(),
  mockRmdir: vi.fn(),
}));

vi.mock('child_process', () => ({ spawn: mockSpawn }));

vi.mock('fs', () => ({
  promises: {
    rm: mockRm,
    rmdir: mockRmdir,
    mkdir: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    stat: vi.fn(),
    rename: vi.fn(),
    copyFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

vi.mock('../services/NodeRegistry', () => ({
  NodeRegistry: {
    getInstance: () => ({
      getComposeDir: () => '/test/compose',
      getDefaultNodeId: () => 1,
    }),
  },
}));

import { FileSystemService } from '../services/FileSystemService';

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

const expectedDir = path.join('/test/compose', 'my-stack');

describe('FileSystemService.deleteStack', () => {
  let service: FileSystemService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = FileSystemService.getInstance();
  });

  it('deletes a stack directory successfully via fsPromises.rm', async () => {
    mockRm.mockResolvedValueOnce(undefined);
    await service.deleteStack('my-stack');
    expect(mockRm).toHaveBeenCalledWith(expectedDir, { recursive: true, force: true });
  });

  it('silently ignores ENOENT (directory already gone)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockRm.mockRejectedValueOnce(err);
    await expect(service.deleteStack('gone-stack')).resolves.toBeUndefined();
  });

  it('falls back to Docker removal on EACCES', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockRm.mockRejectedValueOnce(err);
    mockRmdir.mockResolvedValueOnce(undefined);

    const proc = createMockProcess();
    mockSpawn.mockReturnValueOnce(proc);

    const promise = service.deleteStack('restricted-stack');
    // Emit close asynchronously so listeners are attached first
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });
    proc.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
    expect(mockSpawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['run', '--rm', '-v', expect.stringContaining(':/cleanup'), 'alpine', 'sh', '-c', 'find /cleanup -mindepth 1 -maxdepth 1 -exec rm -rf {} +']),
      expect.objectContaining({ env: expect.any(Object) }),
    );
  });

  it('falls back to Docker removal on EPERM', async () => {
    const err = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    mockRm.mockRejectedValueOnce(err);
    mockRmdir.mockResolvedValueOnce(undefined);

    const proc = createMockProcess();
    mockSpawn.mockReturnValueOnce(proc);

    const promise = service.deleteStack('eperm-stack');
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });
    proc.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('throws descriptive error when Docker fallback fails', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockRm.mockRejectedValueOnce(err);

    const proc = createMockProcess();
    mockSpawn.mockReturnValueOnce(proc);

    const promise = service.deleteStack('stuck-stack');
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });
    proc.stderr.emit('data', Buffer.from('container error'));
    proc.emit('close', 1);

    await expect(promise).rejects.toThrow(/Docker cleanup exited with code 1/);
  });

  it('throws descriptive error when Docker is unavailable', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockRm.mockRejectedValueOnce(err);

    const proc = createMockProcess();
    mockSpawn.mockReturnValueOnce(proc);

    const promise = service.deleteStack('no-docker-stack');
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });
    proc.emit('error', new Error('spawn docker ENOENT'));

    await expect(promise).rejects.toThrow(/could not run Docker for cleanup/);
  });

  it('still succeeds if rmdir of empty shell fails after Docker cleanup', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockRm.mockRejectedValueOnce(err);
    mockRmdir.mockRejectedValueOnce(new Error('rmdir failed'));

    const proc = createMockProcess();
    mockSpawn.mockReturnValueOnce(proc);

    const promise = service.deleteStack('partial-cleanup');
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });
    proc.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('throws on unexpected errors (not ENOENT/EACCES/EPERM)', async () => {
    const err = Object.assign(new Error('disk I/O error'), { code: 'EIO' });
    mockRm.mockRejectedValueOnce(err);

    await expect(service.deleteStack('io-error-stack')).rejects.toThrow(/disk I\/O error/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
