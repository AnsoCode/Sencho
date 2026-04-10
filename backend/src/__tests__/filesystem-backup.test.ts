/**
 * Verifies that FileSystemService stores stack backups under
 * <DATA_DIR>/backups/<stackName>/ rather than inside the user's compose
 * folder. The old in-stack-folder location failed with EACCES whenever a
 * container had chowned the bind mount, breaking the atomic rollback
 * feature for those stacks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { promises as fsPromises } from 'fs';

// Mutable state the mocked NodeRegistry reads. Each test rewrites these
// before instantiating FileSystemService.
const mockState = { composeDir: '' };

vi.mock('../services/NodeRegistry', () => ({
  NodeRegistry: {
    getInstance: () => ({
      getComposeDir: () => mockState.composeDir,
      getDefaultNodeId: () => 1,
    }),
  },
}));

import { FileSystemService } from '../services/FileSystemService';

describe('FileSystemService backup location', () => {
  let composeDir: string;
  let dataDir: string;
  let originalDataDir: string | undefined;

  beforeEach(async () => {
    composeDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'sencho-compose-'));
    dataDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'sencho-data-'));
    mockState.composeDir = composeDir;
    originalDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = dataDir;
  });

  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    await fsPromises.rm(composeDir, { recursive: true, force: true });
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  });

  it('writes backups under <DATA_DIR>/backups/<stackName>/, not inside the stack folder', async () => {
    const stackName = 'web';
    const stackDir = path.join(composeDir, stackName);
    await fsPromises.mkdir(stackDir, { recursive: true });
    await fsPromises.writeFile(path.join(stackDir, 'compose.yaml'), 'services: {}\n', 'utf-8');
    await fsPromises.writeFile(path.join(stackDir, '.env'), 'FOO=bar\n', 'utf-8');

    const service = FileSystemService.getInstance();
    await service.backupStackFiles(stackName);

    const newBackupDir = path.join(dataDir, 'backups', stackName);
    const oldBackupDir = path.join(stackDir, '.sencho-backup');

    // New location has every backed-up file
    await expect(fsPromises.access(path.join(newBackupDir, 'compose.yaml'))).resolves.toBeUndefined();
    await expect(fsPromises.access(path.join(newBackupDir, '.env'))).resolves.toBeUndefined();
    const ts = await fsPromises.readFile(path.join(newBackupDir, '.timestamp'), 'utf-8');
    expect(parseInt(ts, 10)).toBeGreaterThan(0);

    // Old location must NOT be created
    await expect(fsPromises.access(oldBackupDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('getBackupInfo reads from the new location', async () => {
    const stackName = 'api';
    await fsPromises.mkdir(path.join(composeDir, stackName), { recursive: true });
    await fsPromises.writeFile(path.join(composeDir, stackName, 'compose.yaml'), 'services: {}\n', 'utf-8');

    const service = FileSystemService.getInstance();
    const before = await service.getBackupInfo(stackName);
    expect(before).toEqual({ exists: false, timestamp: null });

    await service.backupStackFiles(stackName);
    const after = await service.getBackupInfo(stackName);
    expect(after.exists).toBe(true);
    expect(typeof after.timestamp).toBe('number');
  });

  it('restoreStackFiles copies files from the new location back to the stack dir', async () => {
    const stackName = 'db';
    const stackDir = path.join(composeDir, stackName);
    await fsPromises.mkdir(stackDir, { recursive: true });
    await fsPromises.writeFile(path.join(stackDir, 'compose.yaml'), 'version: original\n', 'utf-8');

    const service = FileSystemService.getInstance();
    await service.backupStackFiles(stackName);

    // Mutate the live stack file, then restore
    await fsPromises.writeFile(path.join(stackDir, 'compose.yaml'), 'version: mutated\n', 'utf-8');
    await service.restoreStackFiles(stackName);

    const restored = await fsPromises.readFile(path.join(stackDir, 'compose.yaml'), 'utf-8');
    expect(restored).toBe('version: original\n');
  });
});
