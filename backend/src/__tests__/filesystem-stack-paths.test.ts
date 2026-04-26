/**
 * Tests for isValidRelativeStackPath (pure function) and the stack-scoped
 * file methods on FileSystemService (listStackDirectory, readStackFile,
 * writeStackFile, writeStackFileBuffer, deleteStackPath, mkdirStackPath).
 *
 * FileSystemService stack methods are tested against a real temp directory so
 * that realpath, stat, and fs I/O all run with actual OS semantics.
 * NodeRegistry is mocked to redirect the composeDir to our temp location.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { isValidRelativeStackPath } from '../utils/validation';

// On Windows, fs.unlink on a directory returns EPERM rather than EISDIR.
// The deleteStackPath empty-dir and NOT_EMPTY paths rely on EISDIR (Linux/macOS).
// Skip those specific cases on Windows.
const isWindows = process.platform === 'win32';

// Mutable state the mocked NodeRegistry reads. Each beforeEach updates it
// before any FileSystemService method runs.
const mockState = { composeDir: '' };

vi.mock('../services/NodeRegistry', () => ({
  NodeRegistry: {
    getInstance: () => ({
      getComposeDir: () => mockState.composeDir,
      getDefaultNodeId: () => 1,
    }),
  },
}));

vi.mock('../utils/debug', () => ({ isDebugEnabled: () => false }));

import { FileSystemService } from '../services/FileSystemService';

// ── isValidRelativeStackPath ──────────────────────────────────────────────────

describe('isValidRelativeStackPath', () => {
  // Accepted inputs
  it('accepts empty string (stack root)', () => expect(isValidRelativeStackPath('')).toBe(true));
  it('accepts simple filename', () => expect(isValidRelativeStackPath('compose.yaml')).toBe(true));
  it('accepts dotfile', () => expect(isValidRelativeStackPath('.env')).toBe(true));
  it('accepts nested path', () => expect(isValidRelativeStackPath('config/app.conf')).toBe(true));
  it('accepts deeply nested path', () => expect(isValidRelativeStackPath('a/b/c/d.txt')).toBe(true));

  // Rejected inputs
  it('rejects ..', () => expect(isValidRelativeStackPath('..')).toBe(false));
  it('rejects ../etc/passwd traversal', () => expect(isValidRelativeStackPath('../etc/passwd')).toBe(false));
  it('rejects a/../b', () => expect(isValidRelativeStackPath('a/../b')).toBe(false));
  it('rejects absolute path', () => expect(isValidRelativeStackPath('/etc/passwd')).toBe(false));
  it('rejects Windows drive path', () => expect(isValidRelativeStackPath('C:/windows')).toBe(false));
  it('rejects NUL byte', () => expect(isValidRelativeStackPath('file\x00name')).toBe(false));
  it('rejects backslash', () => expect(isValidRelativeStackPath('path\\file')).toBe(false));
  it('rejects double-slash', () => expect(isValidRelativeStackPath('a//b')).toBe(false));
  it('rejects bare dot segment', () => expect(isValidRelativeStackPath('a/./b')).toBe(false));
});

// ── FileSystemService stack methods ──────────────────────────────────────────

describe('FileSystemService stack methods', () => {
  const STACK = 'mystack';
  let tmpBase: string;
  let stackDir: string;

  beforeEach(async () => {
    tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'sencho-fsp-'));
    stackDir = path.join(tmpBase, STACK);
    mockState.composeDir = tmpBase;
    await fs.mkdir(stackDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpBase, { recursive: true, force: true });
  });

  // ── listStackDirectory ──────────────────────────────────────────────────

  describe('listStackDirectory', () => {
    it('returns entries with directories sorted before files', async () => {
      await fs.mkdir(path.join(stackDir, 'config'));
      await fs.writeFile(path.join(stackDir, 'compose.yaml'), 'services: {}\n');
      await fs.writeFile(path.join(stackDir, '.env'), 'KEY=val\n');

      const service = FileSystemService.getInstance();
      const entries = await service.listStackDirectory(STACK, '');

      // Directories come first
      expect(entries[0].type).toBe('directory');
      expect(entries[0].name).toBe('config');

      // Files follow, sorted alphabetically (case-insensitive)
      const fileNames = entries.filter(e => e.type === 'file').map(e => e.name);
      expect(fileNames).toEqual(['.env', 'compose.yaml']);
    });

    it('marks compose.yaml and .env as protected', async () => {
      await fs.writeFile(path.join(stackDir, 'compose.yaml'), '');
      await fs.writeFile(path.join(stackDir, '.env'), '');
      await fs.writeFile(path.join(stackDir, 'custom.conf'), '');

      const service = FileSystemService.getInstance();
      const entries = await service.listStackDirectory(STACK, '');

      const byName = Object.fromEntries(entries.map(e => [e.name, e]));
      expect(byName['compose.yaml'].isProtected).toBe(true);
      expect(byName['.env'].isProtected).toBe(true);
      expect(byName['custom.conf'].isProtected).toBe(false);
    });

    it('includes size and mtime for files', async () => {
      await fs.writeFile(path.join(stackDir, 'test.txt'), 'hello');

      const service = FileSystemService.getInstance();
      const entries = await service.listStackDirectory(STACK, '');

      const file = entries.find(e => e.name === 'test.txt');
      expect(file).toBeDefined();
      expect(file!.size).toBe(5);
      expect(file!.mtime).toBeGreaterThan(0);
    });

    it('returns empty array for an empty stack directory', async () => {
      const service = FileSystemService.getInstance();
      const entries = await service.listStackDirectory(STACK, '');
      expect(entries).toEqual([]);
    });

    it('lists a subdirectory when relPath is provided', async () => {
      await fs.mkdir(path.join(stackDir, 'sub'));
      await fs.writeFile(path.join(stackDir, 'sub', 'child.txt'), 'data');

      const service = FileSystemService.getInstance();
      const entries = await service.listStackDirectory(STACK, 'sub');
      expect(entries.length).toBe(1);
      expect(entries[0].name).toBe('child.txt');
    });
  });

  // ── readStackFile ───────────────────────────────────────────────────────

  describe('readStackFile', () => {
    it('returns text content for a UTF-8 file', async () => {
      await fs.writeFile(path.join(stackDir, 'compose.yaml'), 'services: {}\n');

      const service = FileSystemService.getInstance();
      const result = await service.readStackFile(STACK, 'compose.yaml');
      expect(result.binary).toBe(false);
      expect(result.oversized).toBe(false);
      expect(result.content).toBe('services: {}\n');
    });

    it('returns binary:true and no content for a binary file', async () => {
      // PNG magic bytes followed by non-printable data
      const pngMagic = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(50, 0xff),
      ]);
      await fs.writeFile(path.join(stackDir, 'icon.png'), pngMagic);

      const service = FileSystemService.getInstance();
      const result = await service.readStackFile(STACK, 'icon.png');
      expect(result.binary).toBe(true);
      expect(result.oversized).toBe(false);
      expect(result.content).toBeUndefined();
    });

    it('returns oversized:true for files exceeding maxBytes', async () => {
      // Write a text file larger than our small maxBytes limit
      await fs.writeFile(path.join(stackDir, 'big.txt'), 'a'.repeat(200));

      const service = FileSystemService.getInstance();
      // maxBytes=100 forces the oversized path
      const result = await service.readStackFile(STACK, 'big.txt', 100);
      expect(result.oversized).toBe(true);
      expect(result.size).toBe(200);
    });

    it('throws IS_DIRECTORY when path points to a directory', async () => {
      await fs.mkdir(path.join(stackDir, 'subdir'));

      const service = FileSystemService.getInstance();
      await expect(service.readStackFile(STACK, 'subdir')).rejects.toMatchObject({ code: 'IS_DIRECTORY' });
    });
  });

  // ── writeStackFile ──────────────────────────────────────────────────────

  describe('writeStackFile', () => {
    it('creates a new file with the given content', async () => {
      const service = FileSystemService.getInstance();
      await service.writeStackFile(STACK, 'new.txt', 'hello world');

      const content = await fs.readFile(path.join(stackDir, 'new.txt'), 'utf-8');
      expect(content).toBe('hello world');
    });

    it('overwrites an existing file', async () => {
      await fs.writeFile(path.join(stackDir, 'data.txt'), 'original');

      const service = FileSystemService.getInstance();
      await service.writeStackFile(STACK, 'data.txt', 'updated');

      const content = await fs.readFile(path.join(stackDir, 'data.txt'), 'utf-8');
      expect(content).toBe('updated');
    });

    it('creates parent directories if they do not exist', async () => {
      const service = FileSystemService.getInstance();
      await service.writeStackFile(STACK, 'deep/nested/file.txt', 'content');

      const content = await fs.readFile(path.join(stackDir, 'deep', 'nested', 'file.txt'), 'utf-8');
      expect(content).toBe('content');
    });
  });

  // ── writeStackFileBuffer ────────────────────────────────────────────────

  describe('writeStackFileBuffer', () => {
    it('writes raw bytes correctly', async () => {
      const data = Buffer.from([0x01, 0x02, 0x03, 0xff]);
      const service = FileSystemService.getInstance();
      await service.writeStackFileBuffer(STACK, 'binary.bin', data);

      const read = await fs.readFile(path.join(stackDir, 'binary.bin'));
      expect(read).toEqual(data);
    });

    it('creates parent directories when needed', async () => {
      const payload = Buffer.from([0xde, 0xad]);
      const service = FileSystemService.getInstance();
      await service.writeStackFileBuffer(STACK, 'sub/img.bin', payload);

      const read = await fs.readFile(path.join(stackDir, 'sub', 'img.bin'));
      expect(read).toEqual(payload);
    });
  });

  // ── deleteStackPath ─────────────────────────────────────────────────────

  describe('deleteStackPath', () => {
    it('deletes a file', async () => {
      await fs.writeFile(path.join(stackDir, 'todelete.txt'), '');

      const service = FileSystemService.getInstance();
      await service.deleteStackPath(STACK, 'todelete.txt');

      await expect(fs.access(path.join(stackDir, 'todelete.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.skipIf(isWindows)('deletes an empty directory (Linux/macOS only: Windows unlink returns EPERM)', async () => {
      await fs.mkdir(path.join(stackDir, 'emptydir'));

      const service = FileSystemService.getInstance();
      await service.deleteStackPath(STACK, 'emptydir');

      await expect(fs.access(path.join(stackDir, 'emptydir'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.skipIf(isWindows)('throws NOT_EMPTY for non-empty directory without recursive flag (Linux/macOS only)', async () => {
      await fs.mkdir(path.join(stackDir, 'nonempty'));
      await fs.writeFile(path.join(stackDir, 'nonempty', 'child.txt'), '');

      const service = FileSystemService.getInstance();
      await expect(service.deleteStackPath(STACK, 'nonempty', false)).rejects.toMatchObject({ code: 'NOT_EMPTY' });
    });

    it('recursively deletes a non-empty directory when recursive=true', async () => {
      await fs.mkdir(path.join(stackDir, 'tree'));
      await fs.writeFile(path.join(stackDir, 'tree', 'child.txt'), '');

      const service = FileSystemService.getInstance();
      await service.deleteStackPath(STACK, 'tree', true);

      await expect(fs.access(path.join(stackDir, 'tree'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  // ── mkdirStackPath ──────────────────────────────────────────────────────

  describe('mkdirStackPath', () => {
    it('creates a new directory', async () => {
      const service = FileSystemService.getInstance();
      await service.mkdirStackPath(STACK, 'newdir');

      const stat = await fs.stat(path.join(stackDir, 'newdir'));
      expect(stat.isDirectory()).toBe(true);
    });

    it('creates nested directories', async () => {
      const service = FileSystemService.getInstance();
      await service.mkdirStackPath(STACK, 'a/b/c');

      const stat = await fs.stat(path.join(stackDir, 'a', 'b', 'c'));
      expect(stat.isDirectory()).toBe(true);
    });

    it('does not throw when directory already exists', async () => {
      await fs.mkdir(path.join(stackDir, 'existing'));

      const service = FileSystemService.getInstance();
      await expect(service.mkdirStackPath(STACK, 'existing')).resolves.toBeUndefined();
    });
  });

  // ── path traversal ──────────────────────────────────────────────────────

  describe('path traversal protection', () => {
    it('throws INVALID_PATH when relPath escapes stack directory via ..', async () => {
      // isValidRelativeStackPath rejects ".." before it reaches the service,
      // but we also test the service-level guard with a stack name that would
      // escape the compose dir (isPathWithinBase check in resolveSafeStackPath).
      const service = FileSystemService.getInstance();
      await expect(service.listStackDirectory('..', '')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    });

    it('throws INVALID_PATH for a stack name with path separator', async () => {
      const service = FileSystemService.getInstance();
      await expect(service.readStackFile('../other', 'file.txt')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    });
  });
});
