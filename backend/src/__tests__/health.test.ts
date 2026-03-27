/**
 * Tests for the public /api/health endpoint.
 * This endpoint must be reachable without authentication.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestDb, cleanupTestDb } from './helpers/setupTestDb';

let tmpDir: string;
let app: import('express').Express;

beforeAll(async () => {
  // setupTestDb must run before any app import so DATA_DIR is set first
  tmpDir = await setupTestDb();
  ({ app } = await import('../index'));
});

afterAll(() => {
  cleanupTestDb(tmpDir);
});

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns uptime as a number', async () => {
    const res = await request(app).get('/api/health');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('does not require an auth token', async () => {
    // No cookie, no Authorization header - must still return 200
    const res = await request(app).get('/api/health');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
