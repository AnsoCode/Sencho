import { LicenseService } from '../services/LicenseService';
import type { EntitlementProvider } from './types';

/**
 * Resolve the EntitlementProvider implementation for this build.
 *
 * Phase 1 (today): the in-tree `LicenseService` (the existing Lemon
 * Squeezy client) implements `EntitlementProvider`. We return its
 * singleton directly. No dynamic import, no fallback path.
 *
 * Phase 2: this function will switch to a dynamic import that
 * distinguishes "package not installed" (fall back to Community) from
 * "package loaded but threw during construction" (re-raise). The
 * narrowing matters because silently downgrading a paid install to
 * Community on a load-time bug would be a license-bypass surface.
 *
 * The function is async today so the Phase-2 swap doesn't change the
 * signature; bootstrap already awaits it.
 */
export async function loadEntitlementProvider(): Promise<EntitlementProvider> {
    return LicenseService.getInstance();
}
