import { DatabaseService } from '../services/DatabaseService';
import { LicenseService } from '../services/LicenseService';
import type { EntitlementProvider } from './types';

const PRO_PACKAGE = '@studio-saelix/sencho-pro';

/**
 * Resolve the EntitlementProvider implementation for this build.
 *
 * Phase 2: try to dynamic-import `@studio-saelix/sencho-pro` first.
 *
 *   - **Module-not-found** (the package is not installed in this build,
 *     e.g. the public BSL Community-only image): fall back to the
 *     in-tree `LicenseService.getInstance()` so existing functionality
 *     is preserved during this transition window. A later cleanup PR
 *     will switch this fallback to `CommunityEntitlementProvider` and
 *     remove `services/LicenseService.ts` from the public repo
 *     entirely; until then, the in-tree fallback keeps the public BSL
 *     repo runnable on its own.
 *
 *   - **Module loaded but threw during construction**: re-raise. A
 *     silent fallback to community would be a license-bypass surface
 *     (a paid install whose private package init bug downgrades them
 *     to community without surfacing the failure). The bootstrap
 *     should crash and the operator investigates.
 *
 * The function is async so the dynamic import does not change the
 * call-site contract.
 */
export async function loadEntitlementProvider(): Promise<EntitlementProvider> {
    try {
        const mod = await import(PRO_PACKAGE);
        // Explicit typing so a structural drift between Sencho's
        // DatabaseService and the package's DatabaseAdapter (e.g. a
        // future widening of the adapter interface) fails type-check
        // here rather than only at production-CI dual-image build
        // time. Sencho's DatabaseService satisfies the adapter shape
        // structurally today.
        const db: import('@studio-saelix/sencho-pro').DatabaseAdapter = DatabaseService.getInstance();
        return new mod.LemonSqueezyEntitlementProvider(db);
    } catch (err) {
        if (isProPackageNotInstalled(err)) {
            // Phase 2 transitional fallback: keep the in-tree
            // LicenseService binding so a Community-only build (no
            // private package installed) still runs through the
            // existing LemonSqueezy path. A follow-up PR will replace
            // this with a CommunityEntitlementProvider and remove
            // services/LicenseService.ts from the public repo.
            return LicenseService.getInstance();
        }
        throw err;
    }
}

/**
 * Distinguish "the private package itself is not installed" (legitimate
 * fallback path) from "the package loaded but threw / a transitive dep
 * is missing" (re-raise so the operator sees the failure).
 *
 * The error code alone is not specific enough: a missing transitive
 * dependency in an installed paid package surfaces with the same
 * `MODULE_NOT_FOUND` code as the package itself missing. We additionally
 * require the error message to mention the private package by name, so
 * the fallback only triggers when Node could not resolve
 * `@studio-saelix/sencho-pro` at the top level.
 *
 * Codes covered: `ERR_MODULE_NOT_FOUND` (Node >=20 ESM), `MODULE_NOT_FOUND`
 * (CJS / older Node). `ERR_PACKAGE_PATH_NOT_EXPORTED` is intentionally
 * NOT treated as "not installed": that fires when the package was
 * resolved but its exports map does not include the path we asked for,
 * which is a packaging bug we want to surface, not silently downgrade.
 */
export function isProPackageNotInstalled(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as Error & { code?: string }).code;
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false;
    return err.message.includes(PRO_PACKAGE);
}
