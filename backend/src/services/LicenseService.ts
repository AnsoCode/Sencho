import crypto from 'crypto';
import axios from 'axios';
import { DatabaseService } from './DatabaseService';

export type LicenseTier = 'community' | 'paid';
export type LicenseStatus = 'community' | 'trial' | 'active' | 'expired' | 'disabled';

export type LicenseVariant = 'skipper' | 'admiral' | null;

const VALID_TIERS: readonly string[] = ['community', 'paid'] satisfies readonly LicenseTier[];
const VALID_VARIANTS: readonly string[] = ['skipper', 'admiral'] satisfies readonly LicenseVariant[];

export function isLicenseTier(value: unknown): value is LicenseTier {
    return typeof value === 'string' && (VALID_TIERS as readonly string[]).includes(value);
}

export function isLicenseVariant(value: unknown): value is Exclude<LicenseVariant, null> {
    return typeof value === 'string' && (VALID_VARIANTS as readonly string[]).includes(value);
}

/** Header names used for Distributed License Enforcement between nodes. */
export const PROXY_TIER_HEADER = 'x-sencho-tier';
export const PROXY_VARIANT_HEADER = 'x-sencho-variant';

export interface LicenseInfo {
    tier: LicenseTier;
    status: LicenseStatus;
    variant: LicenseVariant;
    customerName: string | null;
    productName: string | null;
    maskedKey: string | null;
    validUntil: string | null;
    trialDaysRemaining: number | null;
    instanceId: string;
    portalUrl: string | null;
    isLifetime: boolean;
}

/** Seat limits per variant. null = unlimited. */
export interface SeatLimits {
    maxAdmins: number | null;
    maxViewers: number | null;
}

const SEAT_LIMITS: Record<string, SeatLimits> = {
    skipper: { maxAdmins: 1, maxViewers: 3 },
    admiral: { maxAdmins: null, maxViewers: null },
};

interface LemonSqueezyActivationResponse {
    activated: boolean;
    error?: string;
    license_key?: {
        id: number;
        status: string;
        key: string;
        activation_limit: number;
        activation_usage: number;
        created_at: string;
        expires_at: string | null;
    };
    instance?: {
        id: string;
        name: string;
        created_at: string;
    };
    meta?: {
        store_id: number;
        order_id: number;
        order_item_id: number;
        product_id: number;
        product_name: string;
        variant_id: number;
        variant_name: string;
        customer_id: number;
        customer_name: string;
        customer_email: string;
    };
}

interface LemonSqueezyValidationResponse {
    valid: boolean;
    error?: string;
    license_key?: {
        id: number;
        status: string;
        key: string;
        activation_limit: number;
        activation_usage: number;
        created_at: string;
        expires_at: string | null;
    };
    meta?: {
        store_id: number;
        order_id: number;
        order_item_id: number;
        product_id: number;
        product_name: string;
        variant_id: number;
        variant_name: string;
        customer_id: number;
        customer_name: string;
        customer_email: string;
    };
}

const LEMON_SQUEEZY_API = 'https://api.lemonsqueezy.com/v1/licenses';
const VALIDATION_INTERVAL_MS = 72 * 60 * 60 * 1000; // 72 hours
const OFFLINE_GRACE_DAYS = 30;
const TRIAL_DURATION_DAYS = 14;

export class LicenseService {
    private static instance: LicenseService;
    private validationTimer: ReturnType<typeof setInterval> | null = null;

    private constructor() { }

    public static getInstance(): LicenseService {
        if (!LicenseService.instance) {
            LicenseService.instance = new LicenseService();
        }
        return LicenseService.instance;
    }

    /**
     * Initialize the license service on startup.
     * Ensures an instance ID exists and starts the 14-day trial on first boot.
     * Also starts periodic validation for active licenses.
     */
    public initialize(): void {
        const db = DatabaseService.getInstance();

        // Generate persistent instance ID on first boot
        if (!db.getSystemState('instance_id')) {
            db.setSystemState('instance_id', crypto.randomUUID());
        }

        // Start 14-day trial on first boot (no license_status means fresh install)
        const currentStatus = db.getSystemState('license_status');
        if (!currentStatus) {
            const trialEnd = new Date();
            trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);
            db.setSystemState('license_status', 'trial');
            db.setSystemState('license_valid_until', trialEnd.toISOString());
            console.log(`[License] 14-day Skipper trial started. Expires: ${trialEnd.toISOString()}`);
        }

        this.startPeriodicValidation();
    }

    /**
     * Returns the current license tier. Synchronous - reads from cached DB state only.
     */
    public getTier(): LicenseTier {
        const db = DatabaseService.getInstance();
        const status = db.getSystemState('license_status') as LicenseStatus | null;

        if (!status || status === 'community') return 'community';
        if (status === 'disabled' || status === 'expired') return 'community';

        if (status === 'trial') {
            const validUntil = db.getSystemState('license_valid_until');
            if (validUntil && new Date(validUntil) > new Date()) {
                return 'paid';
            }
            // Trial expired - update status
            db.setSystemState('license_status', 'community');
            return 'community';
        }

        if (status === 'active') {
            // Check offline grace period
            const lastValidated = db.getSystemState('license_last_validated');
            if (lastValidated) {
                const daysSinceValidation = (Date.now() - parseInt(lastValidated, 10)) / (1000 * 60 * 60 * 24);
                if (daysSinceValidation > OFFLINE_GRACE_DAYS) {
                    console.warn('[License] Offline grace period exceeded. Degrading to community.');
                    db.setSystemState('license_status', 'community');
                    return 'community';
                }
            }

            // Check expiry for subscription licenses
            const validUntil = db.getSystemState('license_valid_until');
            if (validUntil && new Date(validUntil) < new Date()) {
                db.setSystemState('license_status', 'expired');
                return 'community';
            }

            return 'paid';
        }

        return 'community';
    }

    /**
     * Resolve Lemon Squeezy metadata to the internal variant type.
     * Checks both variant_name and product_name since LS variant names may only
     * describe the billing period (e.g. "Lifetime", "Monthly") while the product
     * name contains the tier (e.g. "Sencho Admiral").
     */
    private resolveVariantType(variantName: string, productName?: string): 'skipper' | 'admiral' {
        const combined = `${variantName} ${productName || ''}`.toLowerCase();
        if (combined.includes('team') || combined.includes('admiral')) return 'admiral';
        if (combined.includes('personal') || combined.includes('skipper')) return 'skipper';
        return 'skipper';
    }

    /** Persist variant metadata from Lemon Squeezy response to DB. */
    private storeVariantMeta(db: DatabaseService, meta: { variant_name?: string; variant_id?: number; product_name?: string }): void {
        if (meta.variant_name) {
            db.setSystemState('license_variant_name', meta.variant_name);
            db.setSystemState('license_variant_type', this.resolveVariantType(meta.variant_name, meta.product_name));
        }
        if (meta.variant_id) {
            db.setSystemState('license_variant_id', String(meta.variant_id));
        }
    }

    /**
     * Get the license variant (skipper or admiral) from stored metadata.
     * Trial licenses default to "skipper"; Admiral features require an Admiral license.
     * Reads the pre-resolved `license_variant_type` from DB. Falls back to name-based
     * resolution for pre-existing installs, then persists the result so the fallback
     * only runs once.
     */
    public getVariant(): LicenseVariant {
        const db = DatabaseService.getInstance();
        const status = db.getSystemState('license_status');
        if (status === 'trial') return 'skipper';

        // Primary path: read the pre-resolved type stored at activation/validation
        const storedType = db.getSystemState('license_variant_type');
        if (isLicenseVariant(storedType)) return storedType;

        // Backward compat: resolve from variant/product name for pre-existing installs
        const variantName = db.getSystemState('license_variant_name');
        if (!variantName) return null;
        const productName = db.getSystemState('license_product_name') || undefined;
        const resolved = this.resolveVariantType(variantName, productName);
        db.setSystemState('license_variant_type', resolved);
        return resolved;
    }

    /**
     * Get seat limits for the current license variant.
     */
    public getSeatLimits(): SeatLimits {
        const variant = this.getVariant();
        if (!variant) return { maxAdmins: 1, maxViewers: 0 }; // community
        return SEAT_LIMITS[variant] || SEAT_LIMITS.skipper;
    }

    /**
     * Get full license information for the API response.
     */
    public getLicenseInfo(): LicenseInfo {
        const db = DatabaseService.getInstance();
        const status = (db.getSystemState('license_status') || 'community') as LicenseStatus;
        const key = db.getSystemState('license_key');
        const validUntil = db.getSystemState('license_valid_until');
        const instanceId = db.getSystemState('instance_id') || '';

        let trialDaysRemaining: number | null = null;
        if (status === 'trial' && validUntil) {
            const remaining = (new Date(validUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
            trialDaysRemaining = Math.max(0, Math.ceil(remaining));
        }

        // Lifetime license: active with a stored key but no expiry date
        const isLifetime = status === 'active' && !!key && !validUntil;

        return {
            tier: this.getTier(),
            status,
            variant: this.getVariant(),
            customerName: db.getSystemState('license_customer_name'),
            productName: db.getSystemState('license_product_name'),
            maskedKey: key ? `****-****-****-${key.slice(-4)}` : null,
            validUntil,
            trialDaysRemaining,
            instanceId,
            portalUrl: db.getSystemState('billing_portal_url') || db.getSystemState('customer_portal_url') || null,
            isLifetime,
        };
    }

    /**
     * Activate a license key with Lemon Squeezy.
     */
    public async activate(licenseKey: string): Promise<{ success: boolean; error?: string }> {
        const db = DatabaseService.getInstance();
        const instanceId = db.getSystemState('instance_id') || crypto.randomUUID();

        try {
            const response = await axios.post<LemonSqueezyActivationResponse>(
                `${LEMON_SQUEEZY_API}/activate`,
                {
                    license_key: licenseKey,
                    instance_name: instanceId,
                },
                { timeout: 15000 }
            );

            const data = response.data;
            if (!data.activated) {
                return { success: false, error: data.error || 'Activation failed' };
            }

            // Store license data
            db.setSystemState('license_key', licenseKey);
            db.setSystemState('license_instance_id', data.instance?.id || '');
            db.setSystemState('license_status', 'active');
            db.setSystemState('license_last_validated', Date.now().toString());

            if (data.license_key?.expires_at) {
                db.setSystemState('license_valid_until', data.license_key.expires_at);
            } else {
                // Lifetime license - no expiry
                db.setSystemState('license_valid_until', '');
            }

            if (data.meta?.customer_name) {
                db.setSystemState('license_customer_name', data.meta.customer_name);
            }
            if (data.meta?.product_name) {
                db.setSystemState('license_product_name', data.meta.product_name);
            }
            if (data.meta) {
                this.storeVariantMeta(db, data.meta);
            }
            if (data.meta?.customer_id) {
                db.setSystemState('customer_id', String(data.meta.customer_id));
            }

            // Clear any cached portal URL so it's refreshed on next request
            db.setSystemState('billing_portal_url', '');
            db.setSystemState('billing_portal_expires', '');

            console.log('[License] Activated successfully.');
            return { success: true };
        } catch (err) {
            // Handle Lemon Squeezy error responses (4xx)
            if (axios.isAxiosError(err) && err.response?.data) {
                const errorMsg = err.response.data.error || 'Activation failed';
                console.error('[License] Activation error:', errorMsg);
                return { success: false, error: errorMsg };
            }
            console.error('[License] Activation network error:', (err as Error).message);
            return { success: false, error: 'Unable to reach license server. Check your internet connection.' };
        }
    }

    /**
     * Deactivate the current license, reverting to community.
     */
    public async deactivate(): Promise<{ success: boolean; error?: string }> {
        const db = DatabaseService.getInstance();
        const licenseKey = db.getSystemState('license_key');
        const instanceId = db.getSystemState('license_instance_id');

        if (licenseKey && instanceId) {
            try {
                await axios.post(
                    `${LEMON_SQUEEZY_API}/deactivate`,
                    {
                        license_key: licenseKey,
                        instance_id: instanceId,
                    },
                    { timeout: 15000 }
                );
            } catch (err) {
                console.warn('[License] Deactivation API call failed (proceeding with local cleanup):', (err as Error).message);
            }
        }

        // Clear all license state
        const keysToRemove = [
            'license_key',
            'license_instance_id',
            'license_status',
            'license_valid_until',
            'license_last_validated',
            'license_customer_name',
            'license_product_name',
            'license_variant_name',
            'license_variant_type',
            'license_variant_id',
            'subscription_id',
            'customer_id',
            'customer_portal_url',
            'update_payment_url',
            'order_id',
            'receipt_url',
            'billing_portal_url',
            'billing_portal_expires',
        ];
        for (const key of keysToRemove) {
            db.setSystemState(key, '');
        }
        db.setSystemState('license_status', 'community');

        console.log('[License] Deactivated. Reverted to Community tier.');
        return { success: true };
    }

    /**
     * Validate the current license against Lemon Squeezy.
     */
    public async validate(): Promise<{ success: boolean; error?: string }> {
        const db = DatabaseService.getInstance();
        const licenseKey = db.getSystemState('license_key');
        const instanceId = db.getSystemState('license_instance_id');

        if (!licenseKey || !instanceId) {
            return { success: false, error: 'No active license to validate' };
        }

        try {
            const response = await axios.post<LemonSqueezyValidationResponse>(
                `${LEMON_SQUEEZY_API}/validate`,
                {
                    license_key: licenseKey,
                    instance_id: instanceId,
                },
                { timeout: 15000 }
            );

            const data = response.data;
            db.setSystemState('license_last_validated', Date.now().toString());

            if (!data.valid) {
                // License revoked or invalid
                db.setSystemState('license_status', 'disabled');
                console.warn('[License] Validation failed: license is no longer valid.');
                return { success: false, error: data.error || 'License is no longer valid' };
            }

            // Update status based on key status
            const keyStatus = data.license_key?.status;
            if (keyStatus === 'expired') {
                db.setSystemState('license_status', 'expired');
                return { success: false, error: 'License has expired' };
            }
            if (keyStatus === 'disabled') {
                db.setSystemState('license_status', 'disabled');
                return { success: false, error: 'License has been disabled' };
            }

            db.setSystemState('license_status', 'active');

            // Update expiry if changed
            if (data.license_key?.expires_at) {
                db.setSystemState('license_valid_until', data.license_key.expires_at);
            }

            // Update customer/product info if available
            if (data.meta?.customer_name) {
                db.setSystemState('license_customer_name', data.meta.customer_name);
            }
            if (data.meta?.product_name) {
                db.setSystemState('license_product_name', data.meta.product_name);
            }
            if (data.meta) {
                this.storeVariantMeta(db, data.meta);
            }
            if (data.meta?.customer_id && !db.getSystemState('customer_id')) {
                db.setSystemState('customer_id', String(data.meta.customer_id));
            }

            console.log('[License] Validation successful.');
            return { success: true };
        } catch (err) {
            // Network failure - don't change status, just log
            console.warn('[License] Validation network error (keeping current status):', (err as Error).message);
            return { success: false, error: 'Unable to reach license server' };
        }
    }

    /**
     * Fetch a signed billing portal URL via the sencho.io proxy.
     * Returns a pre-signed Lemon Squeezy Customer Portal URL (valid 24hrs).
     * Caches the URL for 12 hours to reduce external API calls.
     */
    public async getBillingPortalUrl(): Promise<string | null> {
        const db = DatabaseService.getInstance();
        const status = db.getSystemState('license_status');
        const licenseKey = db.getSystemState('license_key');

        if (status !== 'active' || !licenseKey) {
            return null;
        }

        // Check cache (12hr TTL)
        const cachedUrl = db.getSystemState('billing_portal_url');
        const cachedExpires = db.getSystemState('billing_portal_expires');
        if (cachedUrl && cachedExpires && Date.now() < parseInt(cachedExpires, 10)) {
            return cachedUrl;
        }

        try {
            const response = await axios.post<{ url: string }>(
                'https://sencho.io/api/billing-portal',
                { license_key: licenseKey },
                { timeout: 15000 }
            );

            const url = response.data?.url;
            if (!url) {
                return null;
            }

            // Cache for 12 hours
            const ttl = 12 * 60 * 60 * 1000;
            db.setSystemState('billing_portal_url', url);
            db.setSystemState('billing_portal_expires', String(Date.now() + ttl));

            return url;
        } catch (err) {
            console.warn('[License] Failed to fetch billing portal URL:', (err as Error).message);
            // Return stale cache if available
            if (cachedUrl) return cachedUrl;
            return null;
        }
    }

    /**
     * Start periodic background validation every 72 hours.
     */
    public startPeriodicValidation(): void {
        if (this.validationTimer) {
            clearInterval(this.validationTimer);
        }

        this.validationTimer = setInterval(async () => {
            const db = DatabaseService.getInstance();
            const status = db.getSystemState('license_status');
            // Only validate active licenses (not trial, community, etc.)
            if (status === 'active') {
                await this.validate();
            }
        }, VALIDATION_INTERVAL_MS);

        // Run an initial validation on startup for active licenses (after a short delay)
        const db = DatabaseService.getInstance();
        if (db.getSystemState('license_status') === 'active') {
            setTimeout(() => this.validate(), 5000);
        }
    }

    /**
     * Cleanup on shutdown.
     */
    public destroy(): void {
        if (this.validationTimer) {
            clearInterval(this.validationTimer);
            this.validationTimer = null;
        }
    }
}
