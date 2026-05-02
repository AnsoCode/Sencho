/**
 * Smoke test for `CommunityEntitlementProvider`. The class is the Phase
 * 2 fallback for a build that ships without `@studio-saelix/sencho-pro`
 * and is NOT instantiated in production today. This test exists to keep
 * the class covered against bitrot: every test run proves the
 * EntitlementProvider interface still matches and the Community
 * implementation still satisfies the contract.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, cleanupTestDb } from './helpers/setupTestDb';

let tmpDir: string;

beforeAll(async () => {
    tmpDir = await setupTestDb();
});

afterAll(() => {
    cleanupTestDb(tmpDir);
});

describe('CommunityEntitlementProvider', () => {
    it('reports community tier and null variant', async () => {
        const { CommunityEntitlementProvider } = await import('../entitlements/CommunityEntitlementProvider');
        const provider = new CommunityEntitlementProvider();

        expect(provider.getTier()).toBe('community');
        expect(provider.getVariant()).toBeNull();
        expect(provider.getProxyHeaders()).toEqual({ tier: 'community', variant: null });
    });

    it('returns single-admin seat limits matching the Community plan', async () => {
        const { CommunityEntitlementProvider } = await import('../entitlements/CommunityEntitlementProvider');
        const provider = new CommunityEntitlementProvider();
        expect(provider.getSeatLimits()).toEqual({ maxAdmins: 1, maxViewers: 0 });
    });

    it('rejects activate() with a clear install-the-private-package message', async () => {
        const { CommunityEntitlementProvider } = await import('../entitlements/CommunityEntitlementProvider');
        const provider = new CommunityEntitlementProvider();
        const result = await provider.activate('any-key');
        expect(result.success).toBe(false);
        expect(result.error).toContain('@studio-saelix/sencho-pro');
    });

    it('deactivate() is a successful no-op', async () => {
        const { CommunityEntitlementProvider } = await import('../entitlements/CommunityEntitlementProvider');
        const provider = new CommunityEntitlementProvider();
        const result = await provider.deactivate();
        expect(result.success).toBe(true);
    });

    it('initialize() seeds a persistent instance_id when one is missing', async () => {
        const { CommunityEntitlementProvider } = await import('../entitlements/CommunityEntitlementProvider');
        const { DatabaseService } = await import('../services/DatabaseService');

        const db = DatabaseService.getInstance();
        db.setSystemState('instance_id', '');
        new CommunityEntitlementProvider().initialize();
        expect(db.getSystemState('instance_id')).toBeTruthy();
    });

    it('getLicenseInfo() returns Community-only state', async () => {
        const { CommunityEntitlementProvider } = await import('../entitlements/CommunityEntitlementProvider');
        const info = new CommunityEntitlementProvider().getLicenseInfo();
        expect(info.tier).toBe('community');
        expect(info.status).toBe('community');
        expect(info.variant).toBeNull();
        expect(info.maskedKey).toBeNull();
        expect(info.isLifetime).toBe(false);
    });
});
