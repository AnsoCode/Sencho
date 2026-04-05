/**
 * Tests for LicenseService: variant resolution, tier computation, lifetime detection,
 * and getLicenseInfo() output across all license states.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, cleanupTestDb } from './helpers/setupTestDb';

let tmpDir: string;
let svc: import('../services/LicenseService').LicenseService;
let DatabaseService: typeof import('../services/DatabaseService').DatabaseService;

beforeAll(async () => {
  tmpDir = await setupTestDb();
  const licMod = await import('../services/LicenseService');
  svc = licMod.LicenseService.getInstance();
  ({ DatabaseService } = await import('../services/DatabaseService'));
});

afterAll(() => {
  cleanupTestDb(tmpDir);
});

function setLicenseState(overrides: Record<string, string>) {
  const db = DatabaseService.getInstance();
  const keys = [
    'license_status', 'license_key', 'license_valid_until',
    'license_last_validated', 'license_customer_name',
    'license_product_name', 'license_variant_name',
    'billing_portal_url', 'billing_portal_expires',
  ];
  for (const key of keys) {
    db.setSystemState(key, '');
  }
  for (const [key, value] of Object.entries(overrides)) {
    db.setSystemState(key, value);
  }
}

describe('LicenseService.getVariant()', () => {
  it('returns "personal" for trial licenses', () => {
    setLicenseState({ license_status: 'trial' });
    expect(svc.getVariant()).toBe('personal');
  });

  it('returns null when no variant name is stored', () => {
    setLicenseState({ license_status: 'active' });
    expect(svc.getVariant()).toBeNull();
  });

  it('maps "Team" variant name to "team"', () => {
    setLicenseState({ license_status: 'active', license_variant_name: 'Team' });
    expect(svc.getVariant()).toBe('team');
  });

  it('maps "Personal" variant name to "personal"', () => {
    setLicenseState({ license_status: 'active', license_variant_name: 'Personal' });
    expect(svc.getVariant()).toBe('personal');
  });

  it('maps "Admiral" variant name to "team"', () => {
    setLicenseState({ license_status: 'active', license_variant_name: 'Admiral' });
    expect(svc.getVariant()).toBe('team');
  });

  it('maps "Admiral Lifetime" variant name to "team"', () => {
    setLicenseState({ license_status: 'active', license_variant_name: 'Admiral Lifetime' });
    expect(svc.getVariant()).toBe('team');
  });

  it('maps "Skipper" variant name to "personal"', () => {
    setLicenseState({ license_status: 'active', license_variant_name: 'Skipper' });
    expect(svc.getVariant()).toBe('personal');
  });

  it('maps "Skipper Lifetime" variant name to "personal"', () => {
    setLicenseState({ license_status: 'active', license_variant_name: 'Skipper Lifetime' });
    expect(svc.getVariant()).toBe('personal');
  });

  it('defaults unknown variant names to "personal"', () => {
    setLicenseState({ license_status: 'active', license_variant_name: 'Unknown Variant' });
    expect(svc.getVariant()).toBe('personal');
  });
});

describe('LicenseService.getTier()', () => {
  it('returns "community" when no status is set', () => {
    setLicenseState({});
    // initialize() sets trial on first boot; override to test the empty-status path
    DatabaseService.getInstance().setSystemState('license_status', '');
    expect(svc.getTier()).toBe('community');
  });

  it('returns "community" for community status', () => {
    setLicenseState({ license_status: 'community' });
    expect(svc.getTier()).toBe('community');
  });

  it('returns "community" for expired status', () => {
    setLicenseState({ license_status: 'expired' });
    expect(svc.getTier()).toBe('community');
  });

  it('returns "community" for disabled status', () => {
    setLicenseState({ license_status: 'disabled' });
    expect(svc.getTier()).toBe('community');
  });

  it('returns "paid" for active status with valid license', () => {
    setLicenseState({
      license_status: 'active',
      license_last_validated: Date.now().toString(),
    });
    expect(svc.getTier()).toBe('paid');
  });

  it('returns "paid" for active trial', () => {
    const future = new Date();
    future.setDate(future.getDate() + 7);
    setLicenseState({
      license_status: 'trial',
      license_valid_until: future.toISOString(),
    });
    expect(svc.getTier()).toBe('paid');
  });

  it('returns "community" for expired trial', () => {
    const past = new Date();
    past.setDate(past.getDate() - 1);
    setLicenseState({
      license_status: 'trial',
      license_valid_until: past.toISOString(),
    });
    expect(svc.getTier()).toBe('community');
  });

  it('returns "paid" for lifetime license (no expiry)', () => {
    setLicenseState({
      license_status: 'active',
      license_key: 'test-key-1234',
      license_last_validated: Date.now().toString(),
    });
    expect(svc.getTier()).toBe('paid');
  });
});

describe('LicenseService.getLicenseInfo() - isLifetime', () => {
  it('sets isLifetime=true for active license with key and no expiry', () => {
    setLicenseState({
      license_status: 'active',
      license_key: 'test-key-1234',
      license_last_validated: Date.now().toString(),
    });
    const info = svc.getLicenseInfo();
    expect(info.isLifetime).toBe(true);
    expect(info.trialDaysRemaining).toBeNull();
  });

  it('sets isLifetime=false for active subscription with expiry', () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    setLicenseState({
      license_status: 'active',
      license_key: 'test-key-1234',
      license_valid_until: future.toISOString(),
      license_last_validated: Date.now().toString(),
    });
    const info = svc.getLicenseInfo();
    expect(info.isLifetime).toBe(false);
    expect(info.trialDaysRemaining).toBeNull();
  });

  it('sets isLifetime=false for trial licenses', () => {
    const future = new Date();
    future.setDate(future.getDate() + 14);
    setLicenseState({
      license_status: 'trial',
      license_valid_until: future.toISOString(),
    });
    const info = svc.getLicenseInfo();
    expect(info.isLifetime).toBe(false);
    expect(info.trialDaysRemaining).toBeGreaterThan(0);
  });

  it('sets isLifetime=false for community status', () => {
    setLicenseState({ license_status: 'community' });
    const info = svc.getLicenseInfo();
    expect(info.isLifetime).toBe(false);
    expect(info.trialDaysRemaining).toBeNull();
  });
});

describe('LicenseService.getLicenseInfo() - full scenarios', () => {
  it('returns correct info for an Admiral lifetime license', () => {
    setLicenseState({
      license_status: 'active',
      license_key: 'ABCD-EFGH-IJKL-MN5D',
      license_variant_name: 'Admiral Lifetime',
      license_customer_name: 'Test User',
      license_product_name: 'Sencho Admiral',
      license_last_validated: Date.now().toString(),
    });
    const info = svc.getLicenseInfo();
    expect(info.tier).toBe('paid');
    expect(info.status).toBe('active');
    expect(info.variant).toBe('team');
    expect(info.isLifetime).toBe(true);
    expect(info.trialDaysRemaining).toBeNull();
    expect(info.customerName).toBe('Test User');
    expect(info.productName).toBe('Sencho Admiral');
    expect(info.maskedKey).toBe('****-****-****-MN5D');
  });

  it('returns correct info for a Skipper subscription', () => {
    const future = new Date();
    future.setDate(future.getDate() + 30);
    setLicenseState({
      license_status: 'active',
      license_key: 'ABCD-EFGH-IJKL-SK5D',
      license_variant_name: 'Skipper Monthly',
      license_customer_name: 'Another User',
      license_product_name: 'Sencho Skipper',
      license_valid_until: future.toISOString(),
      license_last_validated: Date.now().toString(),
    });
    const info = svc.getLicenseInfo();
    expect(info.tier).toBe('paid');
    expect(info.status).toBe('active');
    expect(info.variant).toBe('personal');
    expect(info.isLifetime).toBe(false);
    expect(info.trialDaysRemaining).toBeNull();
    expect(info.customerName).toBe('Another User');
  });
});
