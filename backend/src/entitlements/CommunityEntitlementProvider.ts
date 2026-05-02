import crypto from 'crypto';
import { DatabaseService } from '../services/DatabaseService';
import type {
    BillingPortalError,
    BillingPortalResult,
    EntitlementProvider,
    LicenseInfo,
    LicenseTier,
    LicenseVariant,
    SeatLimits,
} from './types';

/**
 * Entitlement provider that returns Community-only state regardless of
 * any stored license. Used as the fallback when `loadEntitlementProvider()`
 * cannot resolve `@studio-saelix/sencho-pro` (a build that ships without
 * the private package).
 *
 * Behavior:
 *   - `getTier()` always returns `'community'`.
 *   - `getVariant()` always returns `null`.
 *   - `activate()` rejects with a clear message pointing the operator
 *     at the private-package install path.
 *   - `getLicenseInfo()` reflects a fresh-install Community state, with
 *     a persistent `instance_id` UUID so heartbeat / log identifiers
 *     stay stable across restarts of the same install.
 *
 * Phase 1 never instantiates this class in production: the in-tree
 * `LicenseService` is used directly. It exists today for parity with
 * the Phase 2 plan and so that `loadEntitlementProvider()` has a
 * non-throwing fallback path the day the private package is the
 * primary binding.
 */
export class CommunityEntitlementProvider implements EntitlementProvider {
    public initialize(): void {
        const db = DatabaseService.getInstance();
        if (!db.getSystemState('instance_id')) {
            db.setSystemState('instance_id', crypto.randomUUID());
        }
    }

    public getTier(): LicenseTier {
        return 'community';
    }

    public getVariant(): LicenseVariant {
        return null;
    }

    public getProxyHeaders(): { tier: LicenseTier; variant: LicenseVariant } {
        return { tier: 'community', variant: null };
    }

    public getSeatLimits(): SeatLimits {
        return { maxAdmins: 1, maxViewers: 0 };
    }

    public getLicenseInfo(): LicenseInfo {
        const instanceId = DatabaseService.getInstance().getSystemState('instance_id') || '';
        return {
            tier: 'community',
            status: 'community',
            variant: null,
            customerName: null,
            productName: null,
            maskedKey: null,
            validUntil: null,
            trialDaysRemaining: null,
            instanceId,
            portalUrl: null,
            isLifetime: false,
        };
    }

    public async activate(_licenseKey: string): Promise<{ success: false; error: string }> {
        return {
            success: false,
            error: 'License activation is not available in this build. Install @studio-saelix/sencho-pro to activate Skipper or Admiral.',
        };
    }

    public async deactivate(): Promise<{ success: true }> {
        return { success: true };
    }

    public async validate(): Promise<{ success: false; error: string }> {
        return { success: false, error: 'No active license to validate' };
    }

    public async getBillingPortalUrl(): Promise<BillingPortalResult | BillingPortalError> {
        return { error: 'Billing portal is not available in this build.' };
    }

    public destroy(): void {
        // No timers, no subscriptions; nothing to clean up.
    }
}
