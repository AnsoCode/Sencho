import type { LicenseTier, LicenseVariant } from './types';

/**
 * Tier and variant guards / normalizers. These are domain knowledge
 * about Sencho's tier model (which strings are accepted on input, how
 * legacy names map to current names), not LemonSqueezy implementation
 * details. They live in the public core so that:
 *
 *   - The proxy layer (`auth.ts`, `remoteNodeProxy.ts`) can parse and
 *     validate tier/variant headers from inbound forwarded requests
 *     without depending on the entitlement provider implementation.
 *   - The host-console upgrade handler can decode trusted proxy tier
 *     claims attached to bearer tokens.
 *
 * Phase 2 deletes `services/LicenseService.ts` but leaves these utility
 * exports here, untouched.
 */

const VALID_TIERS: readonly string[] = ['community', 'paid'] satisfies readonly LicenseTier[];
const VALID_VARIANTS: readonly string[] = ['skipper', 'admiral'] satisfies readonly LicenseVariant[];

/**
 * Legacy tier name accepted on input from older versions of Sencho or
 * older proxy headers; normalized to the current name on read.
 */
const LEGACY_TIER_MAP: Record<string, LicenseTier> = { pro: 'paid' };

/**
 * Legacy variant names accepted on input from older versions of Sencho
 * or older proxy headers; normalized to the current names on read.
 */
const LEGACY_VARIANT_MAP: Record<string, Exclude<LicenseVariant, null>> = {
    personal: 'skipper',
    team: 'admiral',
};

/** Check if value is a recognized tier (current or legacy name). */
export function isLicenseTier(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        ((VALID_TIERS as readonly string[]).includes(value) || value in LEGACY_TIER_MAP)
    );
}

/** Check if value is a recognized variant (current or legacy name). */
export function isLicenseVariant(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        ((VALID_VARIANTS as readonly string[]).includes(value) || value in LEGACY_VARIANT_MAP)
    );
}

/**
 * Normalize a tier value, mapping legacy names to current equivalents.
 * Must be called after `isLicenseTier` validation.
 */
export function normalizeTier(value: string): LicenseTier {
    return LEGACY_TIER_MAP[value] ?? (value as LicenseTier);
}

/**
 * Normalize a variant value, mapping legacy names to current
 * equivalents. Must be called after `isLicenseVariant` validation.
 */
export function normalizeVariant(value: string): Exclude<LicenseVariant, null> {
    return LEGACY_VARIANT_MAP[value] ?? (value as Exclude<LicenseVariant, null>);
}
