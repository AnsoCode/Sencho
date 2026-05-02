/**
 * Tier / variant types and the EntitlementProvider interface that the
 * public Sencho core depends on. The interface is the abstraction
 * boundary that lets a future build pull the Lemon Squeezy validation
 * client out of the public BSL repo and into a private package
 * (`@studio-saelix/sencho-pro`) without touching consumer call sites.
 *
 * Today the LemonSqueezy implementation lives in-tree at
 * `services/LicenseService.ts`. A `CommunityEntitlementProvider` lives
 * alongside this file as the Phase-2 fallback for a build that ships
 * without the private package.
 *
 * See `docs/internal/adrs/2026-05-02-open-core-hybrid-strategy.md` for
 * the full design.
 */

export type LicenseTier = 'community' | 'paid';
export type LicenseStatus = 'community' | 'trial' | 'active' | 'expired' | 'disabled';
export type LicenseVariant = 'skipper' | 'admiral' | null;

export interface ActivationResult {
    success: boolean;
    error?: string;
}

export interface DeactivationResult {
    success: boolean;
    error?: string;
}

export interface ValidationResult {
    success: boolean;
    error?: string;
}

export interface BillingPortalResult {
    url: string;
}

export interface BillingPortalError {
    error: string;
}

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

/**
 * The contract every backend tier-gating consumer talks to. Phase-1
 * binding is `services/LicenseService.ts` (the existing class now
 * implements this interface). Phase 2 will dynamically load
 * `@studio-saelix/sencho-pro` and use its `LemonSqueezyEntitlementProvider`,
 * falling back to `CommunityEntitlementProvider` if the package is
 * absent.
 *
 * Method signatures mirror the existing LicenseService surface so the
 * Phase-1 migration is mechanical (consumers call the same methods on a
 * different binding).
 */
export interface EntitlementProvider {
    /** Idempotent. Called once during bootstrap. */
    initialize(): void;

    /** Synchronous tier read. Backed by cached DB state. */
    getTier(): LicenseTier;

    /** Synchronous variant read. Backed by cached DB state. */
    getVariant(): LicenseVariant;

    /**
     * Cached tier+variant snapshot for the remote-node proxy hot path,
     * which reads tier/variant on every forwarded request. Cache TTL
     * is short and is invalidated on every license-status write.
     */
    getProxyHeaders(): { tier: LicenseTier; variant: LicenseVariant };

    /** Seat limits derived from the current variant. */
    getSeatLimits(): SeatLimits;

    /** Full license info for the API response. */
    getLicenseInfo(): LicenseInfo;

    /** Activate a license key against the backing license service. */
    activate(licenseKey: string): Promise<ActivationResult>;

    /** Deactivate the current license, reverting to community. */
    deactivate(): Promise<DeactivationResult>;

    /** Re-validate the current license against the backing license service. */
    validate(): Promise<ValidationResult>;

    /** Pre-signed billing portal URL, if applicable. */
    getBillingPortalUrl(): Promise<BillingPortalResult | BillingPortalError>;

    /** Cleanup on shutdown. Stops periodic-validation timers, etc. */
    destroy(): void;
}
