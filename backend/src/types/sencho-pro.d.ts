/**
 * Ambient declaration for the private `@studio-saelix/sencho-pro`
 * package so the public Sencho core's TypeScript build passes whether
 * or not the package is installed locally. The runtime shape is
 * defined by the package itself; this stub mirrors the surface the
 * loader uses and nothing more.
 *
 * In production CI the Dockerfile installs the real package; the stub
 * is shadowed by the package's own types and any drift fails the
 * build. Local development without GitHub Packages auth falls back to
 * the stub plus the loader's in-tree LicenseService binding, which
 * keeps `npm install` and `tsc` working for everyone.
 *
 * The `implements EntitlementProvider` clause carries the full method
 * surface; we do not redeclare individual methods here. If the real
 * package ever ships a narrower return type than the interface
 * permits, the local stub would over-widen and lose call-site type
 * info — but call sites only consume the interface (via the registry),
 * so that risk does not materialise.
 */
declare module '@studio-saelix/sencho-pro' {
    import type { EntitlementProvider } from '../entitlements/types';

    /** Minimal database surface the provider needs. The public core's
     * `DatabaseService` satisfies this structurally. */
    export interface DatabaseAdapter {
        getSystemState(key: string): string | null;
        setSystemState(key: string, value: string): void;
    }

    export class LemonSqueezyEntitlementProvider implements EntitlementProvider {
        constructor(db: DatabaseAdapter);
    }
}
