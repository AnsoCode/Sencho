/**
 * Tests for fleet management API endpoints.
 * Covers auth enforcement, input validation, overview, snapshot CRUD, and tier gating.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setupTestDb, cleanupTestDb, TEST_USERNAME, TEST_JWT_SECRET } from './helpers/setupTestDb';

let tmpDir: string;
let app: import('express').Express;
let authHeader: string;
let LicenseService: typeof import('../services/LicenseService').LicenseService;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  ({ app } = await import('../index'));
  ({ LicenseService } = await import('../services/LicenseService'));
  const token = jwt.sign({ username: TEST_USERNAME }, TEST_JWT_SECRET, { expiresIn: '1m' });
  authHeader = `Bearer ${token}`;
});

afterAll(() => {
  cleanupTestDb(tmpDir);
});

function mockTier(tier: 'paid' | 'community') {
  vi.spyOn(LicenseService.getInstance(), 'getTier').mockReturnValue(tier);
}

// ─── Auth Enforcement ───

describe('Fleet endpoints require authentication', () => {
  it('GET /api/fleet/overview returns 401 without auth', async () => {
    const res = await request(app).get('/api/fleet/overview');
    expect(res.status).toBe(401);
  });

  it('GET /api/fleet/update-status returns 401 without auth', async () => {
    const res = await request(app).get('/api/fleet/update-status');
    expect(res.status).toBe(401);
  });

  it('POST /api/fleet/snapshots returns 401 without auth', async () => {
    const res = await request(app).post('/api/fleet/snapshots').send({ description: 'test' });
    expect(res.status).toBe(401);
  });

  it('GET /api/fleet/snapshots returns 401 without auth', async () => {
    const res = await request(app).get('/api/fleet/snapshots');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/fleet/snapshots/1 returns 401 without auth', async () => {
    const res = await request(app).delete('/api/fleet/snapshots/1');
    expect(res.status).toBe(401);
  });

  it('POST /api/fleet/nodes/1/update returns 401 without auth', async () => {
    const res = await request(app).post('/api/fleet/nodes/1/update');
    expect(res.status).toBe(401);
  });

  it('POST /api/fleet/update-all returns 401 without auth', async () => {
    const res = await request(app).post('/api/fleet/update-all');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/fleet/nodes/1/update-status returns 401 without auth', async () => {
    const res = await request(app).delete('/api/fleet/nodes/1/update-status');
    expect(res.status).toBe(401);
  });

  it('DELETE /api/fleet/update-status returns 401 without auth', async () => {
    const res = await request(app).delete('/api/fleet/update-status');
    expect(res.status).toBe(401);
  });
});

// ─── Input Validation ───

describe('Fleet input validation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects NaN nodeId on GET /api/fleet/node/:nodeId/stacks', async () => {
    mockTier('paid');
    const res = await request(app)
      .get('/api/fleet/node/abc/stacks')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid node id/i);
  });

  it('rejects NaN nodeId on GET /api/fleet/node/:nodeId/stacks/:stackName/containers', async () => {
    mockTier('paid');
    const res = await request(app)
      .get('/api/fleet/node/xyz/stacks/mystack/containers')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid node id/i);
  });

  it('rejects invalid stackName on containers endpoint', async () => {
    mockTier('paid');
    // Stack name with characters that fail the alphanumeric+dash+underscore regex
    const res = await request(app)
      .get('/api/fleet/node/1/stacks/bad%20stack%21/containers')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid stack name/i);
  });

  it('rejects NaN snapshot ID on GET /api/fleet/snapshots/:id', async () => {
    mockTier('paid');
    const res = await request(app)
      .get('/api/fleet/snapshots/notanumber')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid snapshot id/i);
  });

  it('rejects oversized snapshot description', async () => {
    mockTier('paid');
    const res = await request(app)
      .post('/api/fleet/snapshots')
      .set('Authorization', authHeader)
      .send({ description: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500 characters/i);
  });
});

// ─── Fleet Overview ───

describe('GET /api/fleet/overview', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app)
      .get('/api/fleet/overview')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('includes the local node', async () => {
    const res = await request(app)
      .get('/api/fleet/overview')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    const local = res.body.find((n: { type: string }) => n.type === 'local');
    expect(local).toBeDefined();
    expect(local.name).toBeTruthy();
  });
});

// ─── Tier Gating ───

describe('Fleet tier gating', () => {
  afterEach(() => vi.restoreAllMocks());

  it('GET /api/fleet/update-status returns 403 on free tier', async () => {
    mockTier('community');
    const res = await request(app)
      .get('/api/fleet/update-status')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PAID_REQUIRED');
  });

  it('GET /api/fleet/snapshots returns 403 on free tier', async () => {
    mockTier('community');
    const res = await request(app)
      .get('/api/fleet/snapshots')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PAID_REQUIRED');
  });

  it('POST /api/fleet/nodes/1/update returns 403 on free tier', async () => {
    mockTier('community');
    const res = await request(app)
      .post('/api/fleet/nodes/1/update')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PAID_REQUIRED');
  });

  it('POST /api/fleet/update-all returns 403 on free tier', async () => {
    mockTier('community');
    const res = await request(app)
      .post('/api/fleet/update-all')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PAID_REQUIRED');
  });

  it('DELETE /api/fleet/nodes/1/update-status returns 403 on free tier', async () => {
    mockTier('community');
    const res = await request(app)
      .delete('/api/fleet/nodes/1/update-status')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PAID_REQUIRED');
  });

  it('DELETE /api/fleet/update-status returns 403 on free tier', async () => {
    mockTier('community');
    const res = await request(app)
      .delete('/api/fleet/update-status')
      .set('Authorization', authHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PAID_REQUIRED');
  });
});

// ─── Update Endpoint Input Validation ───

describe('Fleet update input validation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('POST /api/fleet/nodes/abc/update returns 400 for NaN nodeId', async () => {
    mockTier('paid');
    const res = await request(app)
      .post('/api/fleet/nodes/abc/update')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid node id/i);
  });

  it('POST /api/fleet/nodes/99999/update returns 404 for missing node', async () => {
    mockTier('paid');
    const res = await request(app)
      .post('/api/fleet/nodes/99999/update')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('DELETE /api/fleet/nodes/abc/update-status returns 400 for NaN nodeId', async () => {
    mockTier('paid');
    const res = await request(app)
      .delete('/api/fleet/nodes/abc/update-status')
      .set('Authorization', authHeader);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid node id/i);
  });

  it('DELETE /api/fleet/nodes/99999/update-status returns 404 for missing node', async () => {
    mockTier('paid');
    const res = await request(app)
      .delete('/api/fleet/nodes/99999/update-status')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ─── Admin Role Enforcement ───

describe('Fleet update admin enforcement', () => {
  afterEach(() => vi.restoreAllMocks());

  let viewerHeader: string;

  beforeAll(async () => {
    // Create a viewer user and generate a token for them
    const { DatabaseService } = await import('../services/DatabaseService');
    const db = DatabaseService.getInstance();
    const bcrypt = await import('bcrypt');
    const viewerHash = await bcrypt.hash('viewerpass', 1);
    try {
      db.addUser({ username: 'testviewer', password_hash: viewerHash, role: 'viewer' });
    } catch {
      // User may already exist from a prior run
    }
    const viewerToken = jwt.sign({ username: 'testviewer', role: 'viewer' }, TEST_JWT_SECRET, { expiresIn: '1m' });
    viewerHeader = `Bearer ${viewerToken}`;
  });

  it('POST /api/fleet/nodes/1/update returns 403 for viewer', async () => {
    mockTier('paid');
    const res = await request(app)
      .post('/api/fleet/nodes/1/update')
      .set('Authorization', viewerHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_REQUIRED');
  });

  it('POST /api/fleet/update-all returns 403 for viewer', async () => {
    mockTier('paid');
    const res = await request(app)
      .post('/api/fleet/update-all')
      .set('Authorization', viewerHeader);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIN_REQUIRED');
  });
});

// ─── Snapshot CRUD ───

describe('Fleet snapshot lifecycle', () => {
  afterEach(() => vi.restoreAllMocks());

  let snapshotId: number;

  it('creates a snapshot (POST /api/fleet/snapshots)', async () => {
    mockTier('paid');
    const res = await request(app)
      .post('/api/fleet/snapshots')
      .set('Authorization', authHeader)
      .send({ description: 'Test snapshot' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.description).toBe('Test snapshot');
    snapshotId = res.body.id;
  });

  it('lists snapshots (GET /api/fleet/snapshots)', async () => {
    mockTier('paid');
    const res = await request(app)
      .get('/api/fleet/snapshots')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('snapshots');
    expect(res.body).toHaveProperty('total');
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('gets snapshot detail (GET /api/fleet/snapshots/:id)', async () => {
    mockTier('paid');
    const res = await request(app)
      .get(`/api/fleet/snapshots/${snapshotId}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(snapshotId);
    expect(res.body).toHaveProperty('nodes');
  });

  it('returns 404 for missing snapshot', async () => {
    mockTier('paid');
    const res = await request(app)
      .get('/api/fleet/snapshots/99999')
      .set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });

  it('deletes a snapshot (DELETE /api/fleet/snapshots/:id)', async () => {
    mockTier('paid');
    const res = await request(app)
      .delete(`/api/fleet/snapshots/${snapshotId}`)
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);

    // Verify it's gone
    const check = await request(app)
      .get(`/api/fleet/snapshots/${snapshotId}`)
      .set('Authorization', authHeader);
    expect(check.status).toBe(404);
  });
});
