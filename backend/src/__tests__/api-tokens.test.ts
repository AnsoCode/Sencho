/**
 * Tests for API token scope enforcement, blocked endpoints, expiration, and revocation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { setupTestDb, cleanupTestDb, TEST_JWT_SECRET } from './helpers/setupTestDb';

let tmpDir: string;
let app: import('express').Express;
let DatabaseService: typeof import('../services/DatabaseService').DatabaseService;

/** Create an API token in the DB and return its raw JWT string. */
function createTestApiToken(
  scope: 'read-only' | 'deploy-only' | 'full-admin',
  expiresAt: number | null = null,
): string {
  const rawToken = jwt.sign({ scope: 'api_token', jti: crypto.randomUUID() }, TEST_JWT_SECRET, { expiresIn: '1h' });
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const db = DatabaseService.getInstance();
  const user = db.getUserByUsername('testadmin');
  db.addApiToken({
    token_hash: tokenHash,
    name: `test-${scope}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    scope,
    user_id: user!.id,
    created_at: Date.now(),
    expires_at: expiresAt,
  });
  return rawToken;
}

beforeAll(async () => {
  tmpDir = await setupTestDb();
  ({ DatabaseService } = await import('../services/DatabaseService'));
  ({ app } = await import('../index'));
});

afterAll(() => {
  cleanupTestDb(tmpDir);
});

// ─── Scope Enforcement Middleware ────────────────────────────────────────────

describe('enforceApiTokenScope', () => {
  it('read-only token allows GET requests', async () => {
    const token = createTestApiToken('read-only');
    const res = await request(app)
      .get('/api/stacks')
      .set('Authorization', `Bearer ${token}`);
    // Should not be 403 SCOPE_DENIED (may be 200 or other non-scope error)
    expect(res.body.code).not.toBe('SCOPE_DENIED');
  });

  it('read-only token blocks POST requests', async () => {
    const token = createTestApiToken('read-only');
    const res = await request(app)
      .post('/api/stacks/test-stack/deploy')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SCOPE_DENIED');
  });

  it('deploy-only token allows GET requests', async () => {
    const token = createTestApiToken('deploy-only');
    const res = await request(app)
      .get('/api/stacks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.code).not.toBe('SCOPE_DENIED');
  });

  it('deploy-only token allows POST to deploy patterns', async () => {
    const token = createTestApiToken('deploy-only');
    const res = await request(app)
      .post('/api/stacks/test-stack/deploy')
      .set('Authorization', `Bearer ${token}`);
    // Should not be SCOPE_DENIED (may fail for other reasons like stack not found)
    expect(res.body.code).not.toBe('SCOPE_DENIED');
  });

  it('deploy-only token blocks POST to non-deploy endpoints', async () => {
    const token = createTestApiToken('deploy-only');
    const res = await request(app)
      .post('/api/stacks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'test', content: 'version: "3"' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SCOPE_DENIED');
  });

  it('full-admin token passes scope enforcement on stack routes', async () => {
    const token = createTestApiToken('full-admin');
    const res = await request(app)
      .get('/api/stacks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.code).not.toBe('SCOPE_DENIED');
  });
});

// ─── Blocked Endpoints (human-session-only) ─────────────────────────────────

describe('API token blocked endpoints', () => {
  let fullAdminToken: string;

  beforeAll(() => {
    fullAdminToken = createTestApiToken('full-admin');
  });

  const blockedEndpoints: Array<{ method: 'get' | 'post' | 'put' | 'delete'; path: string; body?: Record<string, unknown> }> = [
    // Password management
    { method: 'put', path: '/api/auth/password', body: { oldPassword: 'x', newPassword: 'y' } },
    // Node token generation
    { method: 'post', path: '/api/auth/generate-node-token' },
    // User management
    { method: 'get', path: '/api/users' },
    { method: 'post', path: '/api/users', body: { username: 'test', password: 'test123', role: 'viewer' } },
    { method: 'put', path: '/api/users/1', body: { role: 'viewer' } },
    { method: 'delete', path: '/api/users/1' },
    // SSO configuration
    { method: 'get', path: '/api/sso/config' },
    { method: 'get', path: '/api/sso/config/ldap' },
    { method: 'put', path: '/api/sso/config/ldap', body: { enabled: true } },
    { method: 'delete', path: '/api/sso/config/ldap' },
    { method: 'post', path: '/api/sso/config/ldap/test' },
    // Node management
    { method: 'post', path: '/api/nodes', body: { name: 'test', type: 'local' } },
    { method: 'put', path: '/api/nodes/1', body: { name: 'updated' } },
    { method: 'delete', path: '/api/nodes/1' },
    // License management
    { method: 'post', path: '/api/license/activate', body: { license_key: 'test' } },
    { method: 'post', path: '/api/license/deactivate' },
    // Console token
    { method: 'post', path: '/api/system/console-token' },
    // Token self-management
    { method: 'get', path: '/api/api-tokens' },
    { method: 'post', path: '/api/api-tokens', body: { name: 'test', scope: 'read-only' } },
    { method: 'delete', path: '/api/api-tokens/1' },
  ];

  for (const { method, path, body } of blockedEndpoints) {
    it(`${method.toUpperCase()} ${path} returns 403 SCOPE_DENIED`, async () => {
      let req = request(app)[method](path).set('Authorization', `Bearer ${fullAdminToken}`);
      if (body) req = req.send(body);
      const res = await req;
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SCOPE_DENIED');
    });
  }
});

// ─── Token Expiration ───────────────────────────────────────────────────────

describe('API token expiration', () => {
  it('expired token returns 401', async () => {
    const token = createTestApiToken('full-admin', Date.now() - 1000); // expired 1s ago
    const res = await request(app)
      .get('/api/stacks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('non-expired token is accepted', async () => {
    const token = createTestApiToken('full-admin', Date.now() + 86400000); // expires in 1 day
    const res = await request(app)
      .get('/api/stacks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(401);
  });
});

// ─── Token Revocation ───────────────────────────────────────────────────────

describe('API token revocation', () => {
  it('revoked token returns 401', async () => {
    const rawToken = createTestApiToken('full-admin');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Revoke by finding the token ID
    const db = DatabaseService.getInstance();
    const apiToken = db.getApiTokenByHash(tokenHash)!;
    db.revokeApiToken(apiToken.id);

    const res = await request(app)
      .get('/api/stacks')
      .set('Authorization', `Bearer ${rawToken}`);
    expect(res.status).toBe(401);
  });
});
