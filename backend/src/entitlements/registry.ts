import type { EntitlementProvider } from './types';

/**
 * Module-scope holder for the active `EntitlementProvider`. Bootstrap
 * calls `setEntitlementProvider()` exactly once after `loadEntitlementProvider()`
 * resolves; consumers call `getEntitlementProvider()` synchronously
 * thereafter (the registry is a sync read of an already-resolved
 * singleton).
 *
 * Splitting this from `loadProvider.ts` keeps the loader's async API
 * separate from the consumer-facing sync API. Tier-gating middleware
 * runs on every request and cannot afford the cost of awaiting an
 * import on each call.
 */
let provider: EntitlementProvider | null = null;

/**
 * Set the active entitlement provider. Called once during bootstrap.
 * Calling it again replaces the provider; the previous instance's
 * `destroy()` is the caller's responsibility (bootstrap currently
 * never replaces).
 */
export function setEntitlementProvider(p: EntitlementProvider): void {
    provider = p;
}

/**
 * Get the active entitlement provider. Throws if called before
 * bootstrap registers one. The throw is intentional: a missing
 * provider is a programming error (forgot to wire `loadEntitlementProvider`),
 * not a runtime condition we want to silently degrade.
 */
export function getEntitlementProvider(): EntitlementProvider {
    if (!provider) {
        throw new Error(
            'EntitlementProvider not initialized. Call loadEntitlementProvider() and setEntitlementProvider() during bootstrap before any tier-gated code runs.',
        );
    }
    return provider;
}

/**
 * Test-only: reset the registry so subsequent tests can install a
 * fresh provider. Not exported from the package barrel; tests import
 * directly from this file.
 */
export function resetEntitlementProviderForTests(): void {
    provider = null;
}
