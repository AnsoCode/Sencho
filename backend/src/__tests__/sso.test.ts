import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDb, cleanupTestDb, TEST_JWT_SECRET } from './helpers/setupTestDb';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';

let tmpDir: string;
let app: Express;
let adminToken: string;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  ({ app } = await import('../index'));
  adminToken = jwt.sign({ username: 'testadmin', role: 'admin' }, TEST_JWT_SECRET, { expiresIn: '1h' });
});

afterAll(() => {
  cleanupTestDb(tmpDir);
});

describe('SSO Providers Endpoint', () => {
  it('GET /api/auth/sso/providers returns empty array when none configured', async () => {
    const res = await supertest(app).get('/api/auth/sso/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('SSO LDAP Login', () => {
  it('POST /api/auth/sso/ldap returns error when LDAP not configured', async () => {
    const res = await supertest(app)
      .post('/api/auth/sso/ldap')
      .send({ username: 'testuser', password: 'testpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('not configured');
  });

  it('POST /api/auth/sso/ldap returns 400 when missing credentials', async () => {
    const res = await supertest(app)
      .post('/api/auth/sso/ldap')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('required');
  });
});

describe('SSO Config Endpoints (Protected)', () => {
  it('GET /api/sso/config returns 401 without auth', async () => {
    const res = await supertest(app).get('/api/sso/config');
    expect(res.status).toBe(401);
  });

  it('GET /api/sso/config returns 403 without Admiral', async () => {
    const res = await supertest(app)
      .get('/api/sso/config')
      .set('Authorization', `Bearer ${adminToken}`);
    // Without an Admiral license, this should be 403
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PRO_REQUIRED');
  });

  it('PUT /api/sso/config/:provider returns 401 without auth', async () => {
    const res = await supertest(app)
      .put('/api/sso/config/ldap')
      .send({ enabled: true });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/sso/config/:provider returns 401 without auth', async () => {
    const res = await supertest(app).delete('/api/sso/config/ldap');
    expect(res.status).toBe(401);
  });
});

describe('SSO OIDC Authorize', () => {
  it('GET /api/auth/sso/oidc/:provider/authorize returns 400 for invalid provider', async () => {
    const res = await supertest(app).get('/api/auth/sso/oidc/invalid_provider/authorize');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid SSO provider');
  });

  it('GET /api/auth/sso/oidc/oidc_google/authorize redirects to error when not configured', async () => {
    const res = await supertest(app).get('/api/auth/sso/oidc/oidc_google/authorize');
    // Should redirect to /?sso_error=...
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('sso_error');
  });
});

describe('SSO OIDC Callback', () => {
  it('GET /api/auth/sso/oidc/:provider/callback redirects with error when no state cookie', async () => {
    const res = await supertest(app)
      .get('/api/auth/sso/oidc/oidc_google/callback?code=test&state=test');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('sso_error');
    expect(res.headers.location).toContain('expired');
  });

  it('GET /api/auth/sso/oidc/:provider/callback redirects with provider error if error param present', async () => {
    const res = await supertest(app)
      .get('/api/auth/sso/oidc/oidc_google/callback?error=access_denied&error_description=User+denied');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('User');
  });
});

describe('SSO User Provisioning', () => {
  // Mock LicenseService to return team variant (unlimited seats) for provisioning tests
  beforeAll(async () => {
    const { LicenseService } = await import('../services/LicenseService');
    vi.spyOn(LicenseService.getInstance(), 'getSeatLimits').mockReturnValue({ maxAdmins: null, maxViewers: null });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('provisionUser creates a new SSO user with correct fields', async () => {
    const { SSOService } = await import('../services/SSOService');
    const { DatabaseService } = await import('../services/DatabaseService');

    const sso = SSOService.getInstance();
    const user = sso.provisionUser({
      authProvider: 'oidc_google',
      providerId: 'google-sub-123',
      preferredUsername: 'John Doe',
      email: 'john@example.com',
      role: 'viewer',
    });

    expect(user.username).toBe('John_Doe');
    expect(user.auth_provider).toBe('oidc_google');
    expect(user.provider_id).toBe('google-sub-123');
    expect(user.email).toBe('john@example.com');
    expect(user.role).toBe('viewer');
    // Password hash should be unusable (SSO prefix)
    expect(user.password_hash).toMatch(/^\$sso\$/);

    // Verify they appear in DB
    const dbUser = DatabaseService.getInstance().getUserByProviderIdentity('oidc_google', 'google-sub-123');
    expect(dbUser).toBeDefined();
    expect(dbUser!.username).toBe('John_Doe');
  });

  it('provisionUser returns existing user on second call', async () => {
    const { SSOService } = await import('../services/SSOService');
    const sso = SSOService.getInstance();

    const user1 = sso.provisionUser({
      authProvider: 'oidc_github',
      providerId: 'github-id-456',
      preferredUsername: 'janedoe',
      email: 'jane@example.com',
      role: 'admin',
    });

    const user2 = sso.provisionUser({
      authProvider: 'oidc_github',
      providerId: 'github-id-456',
      preferredUsername: 'janedoe',
      email: 'jane-new@example.com',
      role: 'admin',
    });

    expect(user1.id).toBe(user2.id);
    // Email should be updated
    expect(user2.email).toBe('jane-new@example.com');
  });

  it('provisionUser handles username collision', async () => {
    const { SSOService } = await import('../services/SSOService');
    const { DatabaseService } = await import('../services/DatabaseService');
    const sso = SSOService.getInstance();

    // Create a local user first
    DatabaseService.getInstance().addUser({
      username: 'collision',
      password_hash: '$2b$10$fake',
      role: 'viewer',
    });

    // Now provision an SSO user with the same preferred username
    const user = sso.provisionUser({
      authProvider: 'ldap',
      providerId: 'cn=collision,ou=users,dc=example',
      preferredUsername: 'collision',
      role: 'viewer',
    });

    // Should have a suffixed username
    expect(user.username).toBe('collision_ldap');
    expect(user.auth_provider).toBe('ldap');
  });

  it('SSO users cannot log in via local password endpoint', async () => {
    // The SSO user from the first test has a $sso$ password hash
    // Trying to log in with any password should fail
    const res = await supertest(app)
      .post('/api/auth/login')
      .send({ username: 'John_Doe', password: 'anything' });
    expect(res.status).toBe(401);
  });
});

describe('SSO Config CRUD (DB layer)', () => {
  it('upsertSSOConfig and getSSOConfig work correctly', async () => {
    const { DatabaseService } = await import('../services/DatabaseService');
    const db = DatabaseService.getInstance();

    db.upsertSSOConfig('ldap', true, JSON.stringify({ ldapUrl: 'ldap://test:389' }));

    const config = db.getSSOConfig('ldap');
    expect(config).toBeDefined();
    expect(config!.enabled).toBe(1);
    expect(JSON.parse(config!.config_json)).toEqual({ ldapUrl: 'ldap://test:389' });

    // Update
    db.upsertSSOConfig('ldap', false, JSON.stringify({ ldapUrl: 'ldap://test2:389' }));
    const updated = db.getSSOConfig('ldap');
    expect(updated!.enabled).toBe(0);
    expect(JSON.parse(updated!.config_json)).toEqual({ ldapUrl: 'ldap://test2:389' });

    // Delete
    db.deleteSSOConfig('ldap');
    expect(db.getSSOConfig('ldap')).toBeUndefined();
  });

  it('getEnabledSSOConfigs filters correctly', async () => {
    const { DatabaseService } = await import('../services/DatabaseService');
    const db = DatabaseService.getInstance();

    db.upsertSSOConfig('oidc_google', true, '{}');
    db.upsertSSOConfig('oidc_github', false, '{}');

    const enabled = db.getEnabledSSOConfigs();
    expect(enabled.length).toBe(1);
    expect(enabled[0].provider).toBe('oidc_google');

    // Cleanup
    db.deleteSSOConfig('oidc_google');
    db.deleteSSOConfig('oidc_github');
  });
});

describe('Database migration - SSO columns', () => {
  it('users table has auth_provider, provider_id, email columns', async () => {
    const { DatabaseService } = await import('../services/DatabaseService');
    const db = DatabaseService.getInstance();

    const user = db.addUser({
      username: 'sso_migration_test',
      password_hash: '$sso$test',
      role: 'viewer',
      auth_provider: 'ldap',
      provider_id: 'cn=test,dc=example',
      email: 'test@example.com',
    });

    const fetched = db.getUser(user);
    expect(fetched).toBeDefined();
    expect(fetched!.auth_provider).toBe('ldap');
    expect(fetched!.provider_id).toBe('cn=test,dc=example');
    expect(fetched!.email).toBe('test@example.com');

    // getUserByProviderIdentity
    const byProvider = db.getUserByProviderIdentity('ldap', 'cn=test,dc=example');
    expect(byProvider).toBeDefined();
    expect(byProvider!.username).toBe('sso_migration_test');
  });
});
