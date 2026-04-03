/**
 * Tests for Distributed License Enforcement: the trust chain where the main
 * instance asserts its license tier to remote nodes via proxy headers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setupTestDb, cleanupTestDb, TEST_USERNAME, TEST_JWT_SECRET } from './helpers/setupTestDb';

let tmpDir: string;
let app: import('express').Express;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  ({ app } = await import('../index'));
});

afterAll(() => {
  cleanupTestDb(tmpDir);
});

/** Helper: sign a token with the test JWT secret. */
const signToken = (payload: Record<string, unknown>, expiresIn: string | number = '1m') =>
  jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });

// We need a Pro-gated route that doesn't depend on Docker or remote nodes.
// /api/webhooks is Pro-gated and just reads from the DB — returns an empty array
// if no webhooks exist.
const PRO_ROUTE = '/api/webhooks';

// For Admiral routes, /api/audit-log is Admiral-gated and reads from the DB.
const ADMIRAL_ROUTE = '/api/audit-log';

// ─── authMiddleware: proxyTier/proxyVariant propagation ─────────────────────

describe('authMiddleware - distributed license headers', () => {
  it('sets proxyTier/proxyVariant for node_proxy tokens with valid tier headers', async () => {
    const token = signToken({ scope: 'node_proxy' });
    // Hit a Pro-gated route with tier assertion - should be allowed
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'pro')
      .set('x-sencho-variant', 'personal');

    // Should NOT get 403 PRO_REQUIRED — the proxy tier assertion grants access
    expect(res.status).not.toBe(403);
  });

  it('ignores tier headers for user session tokens', async () => {
    const token = signToken({ username: TEST_USERNAME, role: 'admin' });
    // Even with tier headers set, a user session should use local license (community)
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'pro')
      .set('x-sencho-variant', 'team');

    // Local license is community in test env → should get 403
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRO_REQUIRED');
  });

  it('ignores tier headers for malformed values on node_proxy tokens', async () => {
    const token = signToken({ scope: 'node_proxy' });
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'enterprise')  // invalid value
      .set('x-sencho-variant', 'mega');     // invalid value

    // Invalid tier header → proxyTier not set → falls back to local (community) → 403
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRO_REQUIRED');
  });

  it('falls back to local tier when no tier headers on node_proxy token', async () => {
    const token = signToken({ scope: 'node_proxy' });
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('Authorization', `Bearer ${token}`);
    // No tier headers → falls back to local (community) → 403

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRO_REQUIRED');
  });
});

// ─── requirePro guard ───────────────────────────────────────────────────────

describe('requirePro - distributed license', () => {
  it('allows access when proxy asserts pro tier', async () => {
    const token = signToken({ scope: 'node_proxy' });
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'pro')
      .set('x-sencho-variant', '');

    expect(res.status).not.toBe(403);
  });

  it('blocks access when proxy asserts community tier', async () => {
    const token = signToken({ scope: 'node_proxy' });
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'community');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRO_REQUIRED');
  });

  it('blocks access for direct user when local tier is community', async () => {
    const token = signToken({ username: TEST_USERNAME, role: 'admin' });
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRO_REQUIRED');
  });
});

// ─── requireAdmiral guard ───────────────────────────────────────────────────

describe('requireAdmiral - distributed license', () => {
  it('allows access when proxy asserts pro tier with team variant', async () => {
    const token = signToken({ scope: 'node_proxy' });
    const res = await request(app)
      .get(ADMIRAL_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'pro')
      .set('x-sencho-variant', 'team');

    expect(res.status).not.toBe(403);
  });

  it('blocks when proxy asserts pro tier with personal variant', async () => {
    const token = signToken({ scope: 'node_proxy' });
    const res = await request(app)
      .get(ADMIRAL_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'pro')
      .set('x-sencho-variant', 'personal');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIRAL_REQUIRED');
  });

  it('blocks when proxy asserts community tier', async () => {
    const token = signToken({ scope: 'node_proxy' });
    const res = await request(app)
      .get(ADMIRAL_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'community');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRO_REQUIRED');
  });

  it('blocks when proxy asserts pro tier with empty variant', async () => {
    const token = signToken({ scope: 'node_proxy' });
    const res = await request(app)
      .get(ADMIRAL_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'pro')
      .set('x-sencho-variant', '');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ADMIRAL_REQUIRED');
  });
});

// ─── Security: header injection prevention ──────────────────────────────────

describe('Security - tier header injection', () => {
  it('cannot elevate access via tier headers on a user session', async () => {
    const token = signToken({ username: TEST_USERNAME, role: 'admin' });
    const res = await request(app)
      .get(ADMIRAL_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'pro')
      .set('x-sencho-variant', 'team');

    // User session → tier headers ignored → local community tier → 403
    expect(res.status).toBe(403);
  });

  it('cannot elevate access via tier headers without any auth', async () => {
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('x-sencho-tier', 'pro')
      .set('x-sencho-variant', 'team');

    expect(res.status).toBe(401);
  });

  it('cannot elevate access with expired node_proxy token', async () => {
    const token = jwt.sign({ scope: 'node_proxy' }, TEST_JWT_SECRET, { expiresIn: '-1s' });
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'pro');

    expect(res.status).toBe(401);
  });

  it('cannot elevate access with token signed by wrong secret', async () => {
    const token = jwt.sign({ scope: 'node_proxy' }, 'wrong-secret', { expiresIn: '1m' });
    const res = await request(app)
      .get(PRO_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('x-sencho-tier', 'pro');

    expect(res.status).toBe(401);
  });
});
