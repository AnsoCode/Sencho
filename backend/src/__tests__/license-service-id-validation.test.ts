/**
 * Tests for the Lemon Squeezy catalog-ID guard in LicenseService.activate()
 * and validate(). Without this guard, any LS license (from any store, any
 * product) returns valid: true on /v1/licenses/validate and unlocks Sencho.
 *
 * The pure-function tests below exercise resolveSenchoVariantFromMeta()
 * directly. The activate() / validate() tests mock axios and DatabaseService
 * so we can drive each rejection branch and assert that no DB writes happen
 * on a non-matching response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    resolveSenchoVariantFromMeta,
    SENCHO_LS_STORE_ID,
    SENCHO_LS_PRODUCT_ID_SKIPPER,
    SENCHO_LS_PRODUCT_ID_ADMIRAL,
} from '../services/LicenseService';

// LS catalog used in the live store. Tests reference these directly so a future
// catalog change forces an explicit test update rather than silently passing.
const VARIANT_SKIPPER_MONTHLY = 1453178;
const VARIANT_SKIPPER_ANNUAL = 1453197;
const VARIANT_SKIPPER_LIFETIME = 1453198;
const VARIANT_ADMIRAL_MONTHLY = 1453209;
const VARIANT_ADMIRAL_ANNUAL = 1453212;
const VARIANT_ADMIRAL_LIFETIME = 1453217;

const buildMeta = (overrides: Partial<{ store_id: number; product_id: number; variant_id: number }> = {}) => ({
    store_id: SENCHO_LS_STORE_ID,
    product_id: SENCHO_LS_PRODUCT_ID_SKIPPER,
    variant_id: VARIANT_SKIPPER_MONTHLY,
    ...overrides,
});

describe('resolveSenchoVariantFromMeta()', () => {
    it('returns null for undefined meta', () => {
        expect(resolveSenchoVariantFromMeta(undefined)).toBeNull();
    });

    it('returns null when store_id is missing', () => {
        expect(resolveSenchoVariantFromMeta({ product_id: SENCHO_LS_PRODUCT_ID_SKIPPER, variant_id: VARIANT_SKIPPER_MONTHLY })).toBeNull();
    });

    it('returns null when store_id does not match the Sencho store', () => {
        expect(resolveSenchoVariantFromMeta(buildMeta({ store_id: 999999 }))).toBeNull();
    });

    it('returns null when product_id is missing', () => {
        expect(resolveSenchoVariantFromMeta({ store_id: SENCHO_LS_STORE_ID, variant_id: VARIANT_SKIPPER_MONTHLY })).toBeNull();
    });

    it('returns null when product_id is not a recognized Sencho product', () => {
        expect(resolveSenchoVariantFromMeta(buildMeta({ product_id: 555555 }))).toBeNull();
    });

    it('returns null when variant_id is missing', () => {
        expect(resolveSenchoVariantFromMeta({ store_id: SENCHO_LS_STORE_ID, product_id: SENCHO_LS_PRODUCT_ID_SKIPPER })).toBeNull();
    });

    it('returns null when variant_id is unknown', () => {
        expect(resolveSenchoVariantFromMeta(buildMeta({ variant_id: 1 }))).toBeNull();
    });

    it.each([
        ['Skipper Monthly', VARIANT_SKIPPER_MONTHLY],
        ['Skipper Annual', VARIANT_SKIPPER_ANNUAL],
        ['Skipper Lifetime', VARIANT_SKIPPER_LIFETIME],
    ])('resolves %s variant to skipper', (_label, variantId) => {
        expect(resolveSenchoVariantFromMeta(buildMeta({ product_id: SENCHO_LS_PRODUCT_ID_SKIPPER, variant_id: variantId }))).toBe('skipper');
    });

    it.each([
        ['Admiral Monthly', VARIANT_ADMIRAL_MONTHLY],
        ['Admiral Annual', VARIANT_ADMIRAL_ANNUAL],
        ['Admiral Lifetime', VARIANT_ADMIRAL_LIFETIME],
    ])('resolves %s variant to admiral', (_label, variantId) => {
        expect(resolveSenchoVariantFromMeta(buildMeta({ product_id: SENCHO_LS_PRODUCT_ID_ADMIRAL, variant_id: variantId }))).toBe('admiral');
    });
});

const {
    mockAxiosPost,
    mockGetSystemState,
    mockSetSystemState,
} = vi.hoisted(() => ({
    mockAxiosPost: vi.fn(),
    mockGetSystemState: vi.fn(),
    mockSetSystemState: vi.fn(),
}));

vi.mock('axios', () => ({
    default: { post: mockAxiosPost, isAxiosError: () => false },
    isAxiosError: () => false,
}));

vi.mock('../services/DatabaseService', () => ({
    DatabaseService: {
        getInstance: () => ({
            getSystemState: mockGetSystemState,
            setSystemState: mockSetSystemState,
        }),
    },
}));

describe('LicenseService.activate() - catalog ID guard', () => {
    let svc: import('../services/LicenseService').LicenseService;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGetSystemState.mockReturnValue('test-instance-uuid');
        const mod = await import('../services/LicenseService');
        svc = mod.LicenseService.getInstance();
    });

    const buildActivationResponse = (meta: object | undefined) => ({
        data: {
            activated: true,
            license_key: { id: 1, status: 'active', key: 'k', activation_limit: 1, activation_usage: 1, created_at: '2026-01-01', expires_at: null },
            instance: { id: 'ls-inst', name: 'test', created_at: '2026-01-01' },
            meta,
        },
    });

    it('rejects activation when meta is absent', async () => {
        mockAxiosPost.mockResolvedValueOnce(buildActivationResponse(undefined));
        const result = await svc.activate('VALID-LOOKING-KEY');
        expect(result.success).toBe(false);
        expect(result.error).toBe('This license key is not valid for Sencho.');
        expect(mockSetSystemState).not.toHaveBeenCalledWith('license_status', 'active');
        expect(mockSetSystemState).not.toHaveBeenCalledWith('license_key', expect.any(String));
    });

    it('rejects activation when store_id does not match', async () => {
        mockAxiosPost.mockResolvedValueOnce(buildActivationResponse(buildMeta({ store_id: 999999 })));
        const result = await svc.activate('FOREIGN-STORE-KEY');
        expect(result.success).toBe(false);
        expect(result.error).toBe('This license key is not valid for Sencho.');
        expect(mockSetSystemState).not.toHaveBeenCalledWith('license_status', 'active');
    });

    it('rejects activation when product_id is not a Sencho product', async () => {
        mockAxiosPost.mockResolvedValueOnce(buildActivationResponse(buildMeta({ product_id: 555555 })));
        const result = await svc.activate('OTHER-PRODUCT-KEY');
        expect(result.success).toBe(false);
        expect(mockSetSystemState).not.toHaveBeenCalledWith('license_status', 'active');
    });

    it('rejects activation when variant_id is unknown', async () => {
        mockAxiosPost.mockResolvedValueOnce(buildActivationResponse(buildMeta({ variant_id: 1 })));
        const result = await svc.activate('UNKNOWN-VARIANT-KEY');
        expect(result.success).toBe(false);
        expect(mockSetSystemState).not.toHaveBeenCalledWith('license_status', 'active');
    });

    it('writes nothing to system_state when the catalog guard rejects', async () => {
        // Stronger than checking individual keys: any future code that adds a
        // setSystemState() call above the guard would silently break the
        // "rejection persists no state" invariant unless the test catches it.
        mockAxiosPost.mockResolvedValueOnce(buildActivationResponse(buildMeta({ store_id: 999999 })));
        await svc.activate('FOREIGN-STORE-KEY');
        expect(mockSetSystemState).not.toHaveBeenCalled();
    });

    it('succeeds and stores admiral variant for an Admiral Lifetime license', async () => {
        mockAxiosPost.mockResolvedValueOnce(buildActivationResponse({
            store_id: SENCHO_LS_STORE_ID,
            product_id: SENCHO_LS_PRODUCT_ID_ADMIRAL,
            variant_id: VARIANT_ADMIRAL_LIFETIME,
            variant_name: 'Admiral Lifetime',
            product_name: 'Sencho Admiral',
        }));
        const result = await svc.activate('GOOD-ADMIRAL-KEY');
        expect(result.success).toBe(true);
        expect(mockSetSystemState).toHaveBeenCalledWith('license_status', 'active');
        expect(mockSetSystemState).toHaveBeenCalledWith('license_variant_type', 'admiral');
        expect(mockSetSystemState).toHaveBeenCalledWith('license_variant_id', String(VARIANT_ADMIRAL_LIFETIME));
    });

    it('succeeds and stores skipper variant for a Skipper Monthly license', async () => {
        mockAxiosPost.mockResolvedValueOnce(buildActivationResponse({
            store_id: SENCHO_LS_STORE_ID,
            product_id: SENCHO_LS_PRODUCT_ID_SKIPPER,
            variant_id: VARIANT_SKIPPER_MONTHLY,
            variant_name: 'Skipper Monthly',
            product_name: 'Sencho Skipper',
        }));
        const result = await svc.activate('GOOD-SKIPPER-KEY');
        expect(result.success).toBe(true);
        expect(mockSetSystemState).toHaveBeenCalledWith('license_variant_type', 'skipper');
    });
});

describe('LicenseService.validate() - catalog ID guard', () => {
    let svc: import('../services/LicenseService').LicenseService;

    beforeEach(async () => {
        vi.clearAllMocks();
        // validate() reads license_key + license_instance_id from DB before
        // calling LS; provide both so the call proceeds to the response check.
        mockGetSystemState.mockImplementation((key: string) => {
            if (key === 'license_key') return 'STORED-KEY';
            if (key === 'license_instance_id') return 'stored-instance';
            return null;
        });
        const mod = await import('../services/LicenseService');
        svc = mod.LicenseService.getInstance();
    });

    const buildValidationResponse = (meta: object | undefined) => ({
        data: {
            valid: true,
            license_key: { id: 1, status: 'active', key: 'k', activation_limit: 1, activation_usage: 1, created_at: '2026-01-01', expires_at: null },
            meta,
        },
    });

    it('rejects validation when meta is absent and disables the license', async () => {
        mockAxiosPost.mockResolvedValueOnce(buildValidationResponse(undefined));
        const result = await svc.validate();
        expect(result.success).toBe(false);
        expect(result.error).toBe('License is not valid for Sencho.');
        expect(mockSetSystemState).toHaveBeenCalledWith('license_status', 'disabled');
    });

    it('rejects validation when store_id no longer matches and disables the license', async () => {
        mockAxiosPost.mockResolvedValueOnce(buildValidationResponse(buildMeta({ store_id: 999999 })));
        const result = await svc.validate();
        expect(result.success).toBe(false);
        expect(mockSetSystemState).toHaveBeenCalledWith('license_status', 'disabled');
    });

    it('keeps the license active when the catalog meta still matches', async () => {
        mockAxiosPost.mockResolvedValueOnce(buildValidationResponse({
            store_id: SENCHO_LS_STORE_ID,
            product_id: SENCHO_LS_PRODUCT_ID_ADMIRAL,
            variant_id: VARIANT_ADMIRAL_ANNUAL,
            variant_name: 'Admiral Annual',
            product_name: 'Sencho Admiral',
        }));
        const result = await svc.validate();
        expect(result.success).toBe(true);
        expect(mockSetSystemState).toHaveBeenCalledWith('license_status', 'active');
        expect(mockSetSystemState).toHaveBeenCalledWith('license_variant_type', 'admiral');
    });

    it('marks the license expired when LS reports key_status=expired even with matching meta', async () => {
        mockAxiosPost.mockResolvedValueOnce({
            data: {
                valid: true,
                license_key: { id: 1, status: 'expired', key: 'k', activation_limit: 1, activation_usage: 1, created_at: '2026-01-01', expires_at: '2026-04-01' },
                meta: {
                    store_id: SENCHO_LS_STORE_ID,
                    product_id: SENCHO_LS_PRODUCT_ID_SKIPPER,
                    variant_id: VARIANT_SKIPPER_MONTHLY,
                    variant_name: 'Skipper Monthly',
                    product_name: 'Sencho Skipper',
                },
            },
        });
        const result = await svc.validate();
        expect(result.success).toBe(false);
        expect(result.error).toBe('License has expired');
        expect(mockSetSystemState).toHaveBeenCalledWith('license_status', 'expired');
        expect(mockSetSystemState).not.toHaveBeenCalledWith('license_status', 'active');
    });

    it('disables the license when LS reports key_status=disabled even with matching meta', async () => {
        mockAxiosPost.mockResolvedValueOnce({
            data: {
                valid: true,
                license_key: { id: 1, status: 'disabled', key: 'k', activation_limit: 1, activation_usage: 1, created_at: '2026-01-01', expires_at: null },
                meta: {
                    store_id: SENCHO_LS_STORE_ID,
                    product_id: SENCHO_LS_PRODUCT_ID_ADMIRAL,
                    variant_id: VARIANT_ADMIRAL_LIFETIME,
                    variant_name: 'Admiral Lifetime',
                    product_name: 'Sencho Admiral',
                },
            },
        });
        const result = await svc.validate();
        expect(result.success).toBe(false);
        expect(result.error).toBe('License has been disabled');
        expect(mockSetSystemState).toHaveBeenCalledWith('license_status', 'disabled');
        expect(mockSetSystemState).not.toHaveBeenCalledWith('license_status', 'active');
    });
});
