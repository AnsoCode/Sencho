import type { LicenseTier, LicenseVariant } from './license-types';

/**
 * Tier and variant guards / normalizers. Domain knowledge about
 * Sencho's tier model (which strings are accepted on input, how legacy
 * names map to current names). Used by:
 *
 *   - The proxy layer (`auth.ts`, `remoteNodeProxy.ts`) to parse and
 *     validate tier/variant headers from inbound forwarded requests.
 *   - The host-console upgrade handler to decode trusted proxy tier
 *     claims attached to bearer tokens.
 */

const VALID_TIERS: readonly string[] = ['community', 'paid'] satisfies readonly LicenseTier[];
const VALID_VARIANTS: readonly string[] = ['skipper', 'admiral'] satisfies readonly LicenseVariant[];

/**
 * Legacy tier name accepted on input from older proxy headers;
 * normalized to the current name on read.
 */
const LEGACY_TIER_MAP: Record<string, LicenseTier> = { pro: 'paid' };

/**
 * Legacy variant names accepted on input from older proxy headers;
 * normalized to the current names on read.
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
