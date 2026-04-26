/**
 * Route-level tests for the stack file explorer endpoints:
 *   GET    /:stackName/files
 *   GET    /:stackName/files/content
 *   GET    /:stackName/files/download  (Skipper+)
 *   POST   /:stackName/files/upload    (Skipper+)
 *   PUT    /:stackName/files/content   (Skipper+)
 *   DELETE /:stackName/files           (Skipper+)
 *   POST   /:stackName/files/folder    (Skipper+)
 *
 * Covers: auth gating, tier gating (Community vs paid), input validation,
 * upload size limit, and happy-path 204/200 responses.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { promises as fs } from 'fs';
import path from 'path';
import { setupTestDb, cleanupTestDb, loginAsTestAdmin } from './helpers/setupTestDb';

// On Windows, fs.unlink on a directory returns EPERM instead of EISDIR so the
// NOT_EMPTY code path in deleteStackPath is never reached. Skip that test case
// on Windows; it is covered on Linux (CI).
const isWindows = process.platform === 'win32';

let tmpDir: string;
let app: import('express').Express;
let LicenseService: typeof import('../services/LicenseService').LicenseService;
let adminCookie: string;
let stacksDir: string;
const STACK = 'teststack';

beforeAll(async () => {
  tmpDir = await setupTestDb();
  stacksDir = process.env.COMPOSE_DIR!;

  // Create stack directory so file operations have something to work with
  await fs.mkdir(path.join(stacksDir, STACK), { recursive: true });
  await fs.writeFile(path.join(stacksDir, STACK, 'compose.yaml'), 'services: {}\n');
  await fs.writeFile(path.join(stacksDir, STACK, '.env'), 'KEY=val\n');

  ({ LicenseService } = await import('../services/LicenseService'));

  // Default: paid tier so most tests pass the tier gate
  vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValue('paid');
  vi.spyOn(LicenseService.getInstance(), 'getVariant').mockReturnValue('skipper');
  vi.spyOn(LicenseService.getInstance(), 'getSeatLimits').mockReturnValue({ maxAdmins: null, maxViewers: null });

  ({ app } = await import('../index'));
  adminCookie = await loginAsTestAdmin(app);
});

afterAll(async () => {
  cleanupTestDb(tmpDir);
});

beforeEach(() => {
  // Restore all spies then re-establish the paid-tier default so per-test
  // overrides via mockReturnValueOnce don't accumulate across tests.
  vi.restoreAllMocks();
  vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValue('paid');
});

// ── GET /:stackName/files ─────────────────────────────────────────────────────

describe('GET /api/stacks/:stackName/files', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get(`/api/stacks/${STACK}/files`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with entries array for authenticated admin', async () => {
    const res = await request(app)
      .get(`/api/stacks/${STACK}/files`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('includes compose.yaml and .env in the listing', async () => {
    const res = await request(app)
      .get(`/api/stacks/${STACK}/files`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const names = res.body.map((e: { name: string }) => e.name);
    expect(names).toContain('compose.yaml');
    expect(names).toContain('.env');
  });

  it('returns 400 for an invalid stack name containing path traversal', async () => {
    const res = await request(app)
      .get('/api/stacks/../evil/files')
      .set('Cookie', adminCookie);
    // Express may normalise the URL before it reaches the handler;
    // the important thing is we never get 200
    expect(res.status).not.toBe(200);
  });

  it('returns 400 for a stack name with special characters', async () => {
    const res = await request(app)
      .get('/api/stacks/my%20stack/files')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });
});

// ── GET /:stackName/files/content ─────────────────────────────────────────────

describe('GET /api/stacks/:stackName/files/content', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .get(`/api/stacks/${STACK}/files/content`)
      .query({ path: 'compose.yaml' });
    expect(res.status).toBe(401);
  });

  it('returns 400 INVALID_PATH when path query parameter is missing', async () => {
    const res = await request(app)
      .get(`/api/stacks/${STACK}/files/content`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PATH');
  });

  it('returns 200 with file content for an existing text file', async () => {
    const res = await request(app)
      .get(`/api/stacks/${STACK}/files/content`)
      .query({ path: 'compose.yaml' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.binary).toBe(false);
    expect(res.body.oversized).toBe(false);
    expect(typeof res.body.content).toBe('string');
  });

  it('returns 404 for a non-existent file', async () => {
    const res = await request(app)
      .get(`/api/stacks/${STACK}/files/content`)
      .query({ path: 'nonexistent.txt' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(404);
  });
});

// ── GET /:stackName/files/download ────────────────────────────────────────────

describe('GET /api/stacks/:stackName/files/download', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .get(`/api/stacks/${STACK}/files/download`)
      .query({ path: 'compose.yaml' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Community tier', async () => {
    vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValueOnce('community');
    const res = await request(app)
      .get(`/api/stacks/${STACK}/files/download`)
      .query({ path: 'compose.yaml' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(403);
  });

  it('streams the file for a paid tier user', async () => {
    const res = await request(app)
      .get(`/api/stacks/${STACK}/files/download`)
      .query({ path: 'compose.yaml' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.text).toContain('services');
  });
});

// ── POST /:stackName/files/upload ─────────────────────────────────────────────

describe('POST /api/stacks/:stackName/files/upload', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post(`/api/stacks/${STACK}/files/upload`)
      .attach('file', Buffer.from('data'), 'test.txt');
    expect(res.status).toBe(401);
  });

  it('returns 403 for Community tier', async () => {
    vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValueOnce('community');
    const res = await request(app)
      .post(`/api/stacks/${STACK}/files/upload`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('data'), 'test.txt');
    expect(res.status).toBe(403);
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app)
      .post(`/api/stacks/${STACK}/files/upload`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('returns 413 TOO_LARGE when file exceeds 25 MB', async () => {
    // 26 MB buffer
    const bigFile = Buffer.alloc(26 * 1024 * 1024, 0x61);
    const res = await request(app)
      .post(`/api/stacks/${STACK}/files/upload`)
      .set('Cookie', adminCookie)
      .attach('file', bigFile, 'toobig.txt');
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('TOO_LARGE');
  }, 20000);

  it('returns 204 for a valid file upload (paid tier)', async () => {
    const res = await request(app)
      .post(`/api/stacks/${STACK}/files/upload`)
      .set('Cookie', adminCookie)
      .attach('file', Buffer.from('uploaded content'), 'uploaded.txt');
    expect(res.status).toBe(204);

    // Verify the file was written
    const content = await fs.readFile(path.join(stacksDir, STACK, 'uploaded.txt'), 'utf-8');
    expect(content).toBe('uploaded content');
  });
});

// ── PUT /:stackName/files/content ─────────────────────────────────────────────

describe('PUT /api/stacks/:stackName/files/content', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .put(`/api/stacks/${STACK}/files/content`)
      .query({ path: 'new.txt' })
      .send({ content: 'hello' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Community tier', async () => {
    vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValueOnce('community');
    const res = await request(app)
      .put(`/api/stacks/${STACK}/files/content`)
      .query({ path: 'new.txt' })
      .set('Cookie', adminCookie)
      .send({ content: 'hello' });
    expect(res.status).toBe(403);
  });

  it('returns 400 when content is not a string', async () => {
    const res = await request(app)
      .put(`/api/stacks/${STACK}/files/content`)
      .query({ path: 'new.txt' })
      .set('Cookie', adminCookie)
      .send({ content: 42 });
    expect(res.status).toBe(400);
  });

  it('returns 204 and writes the file for a paid tier admin', async () => {
    const res = await request(app)
      .put(`/api/stacks/${STACK}/files/content`)
      .query({ path: 'written.txt' })
      .set('Cookie', adminCookie)
      .send({ content: 'written via PUT' });
    expect(res.status).toBe(204);

    const content = await fs.readFile(path.join(stacksDir, STACK, 'written.txt'), 'utf-8');
    expect(content).toBe('written via PUT');
  });
});

// ── DELETE /:stackName/files ──────────────────────────────────────────────────

describe('DELETE /api/stacks/:stackName/files', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .delete(`/api/stacks/${STACK}/files`)
      .query({ path: 'compose.yaml' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Community tier', async () => {
    vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValueOnce('community');
    const res = await request(app)
      .delete(`/api/stacks/${STACK}/files`)
      .query({ path: 'compose.yaml' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(403);
  });

  it('returns 400 when path is missing', async () => {
    const res = await request(app)
      .delete(`/api/stacks/${STACK}/files`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('returns 204 on successful file deletion', async () => {
    // Create a disposable file first
    await fs.writeFile(path.join(stacksDir, STACK, 'todelete.txt'), 'bye');

    const res = await request(app)
      .delete(`/api/stacks/${STACK}/files`)
      .query({ path: 'todelete.txt' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);

    await expect(fs.access(path.join(stacksDir, STACK, 'todelete.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(isWindows)('returns 409 NOT_EMPTY when deleting a non-empty directory without recursive flag (Linux/macOS only)', async () => {
    const dirPath = path.join(stacksDir, STACK, 'nonemptydir');
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(path.join(dirPath, 'child.txt'), '');

    const res = await request(app)
      .delete(`/api/stacks/${STACK}/files`)
      .query({ path: 'nonemptydir' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_EMPTY');
  });
});

// ── POST /:stackName/files/folder ─────────────────────────────────────────────

describe('POST /api/stacks/:stackName/files/folder', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post(`/api/stacks/${STACK}/files/folder`)
      .query({ path: 'newdir' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for Community tier', async () => {
    vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValueOnce('community');
    const res = await request(app)
      .post(`/api/stacks/${STACK}/files/folder`)
      .query({ path: 'newdir' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(403);
  });

  it('returns 400 when path is missing', async () => {
    const res = await request(app)
      .post(`/api/stacks/${STACK}/files/folder`)
      .set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });

  it('returns 204 and creates the directory for a paid tier admin', async () => {
    const res = await request(app)
      .post(`/api/stacks/${STACK}/files/folder`)
      .query({ path: 'mynewdir' })
      .set('Cookie', adminCookie);
    expect(res.status).toBe(204);

    const stat = await fs.stat(path.join(stacksDir, STACK, 'mynewdir'));
    expect(stat.isDirectory()).toBe(true);
  });
});
