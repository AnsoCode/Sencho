/**
 * Unit tests for FileSystemService.deleteStack().
 *
 * Sencho runs as root inside the container by default, so deleteStack only
 * needs to wrap fsPromises.rm and translate ENOENT into a silent no-op.
 * Permission errors are surfaced to the caller like any other failure
 * (no Docker-helper fallback).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

const { mockRm } = vi.hoisted(() => ({
  mockRm: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    rm: mockRm,
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

  it('throws on EACCES (running as root should make this rare)', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mockRm.mockRejectedValueOnce(err);
    await expect(service.deleteStack('restricted-stack')).rejects.toThrow(/permission denied/);
  });

  it('throws on EPERM', async () => {
    const err = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    mockRm.mockRejectedValueOnce(err);
    await expect(service.deleteStack('eperm-stack')).rejects.toThrow(/operation not permitted/);
  });

  it('throws on unexpected errors (e.g. EIO)', async () => {
    const err = Object.assign(new Error('disk I/O error'), { code: 'EIO' });
    mockRm.mockRejectedValueOnce(err);
    await expect(service.deleteStack('io-error-stack')).rejects.toThrow(/disk I\/O error/);
  });
});
