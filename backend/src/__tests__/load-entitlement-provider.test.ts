/**
 * Tests for the loader's module-not-found discrimination. The
 * predicate is a security boundary: a too-wide match silently
 * downgrades a paid install to community on a transitive-dependency
 * bug; a too-narrow match crashes bootstrap on a legitimate
 * Community-only build. Keep these fixtures aligned with the runtime
 * codes Node and bundlers actually produce.
 */
import { describe, it, expect } from 'vitest';
import { isProPackageNotInstalled } from '../entitlements/loadProvider';

function withCode<T extends Error>(err: T, code: string): T {
    (err as Error & { code?: string }).code = code;
    return err;
}

describe('isProPackageNotInstalled', () => {
    it('returns false for non-Error values', () => {
        expect(isProPackageNotInstalled(undefined)).toBe(false);
        expect(isProPackageNotInstalled(null)).toBe(false);
        expect(isProPackageNotInstalled('not an error')).toBe(false);
        expect(isProPackageNotInstalled({})).toBe(false);
    });

    it('returns false for Error without a code', () => {
        expect(isProPackageNotInstalled(new Error('something broke'))).toBe(false);
    });

    it('returns true for ERR_MODULE_NOT_FOUND on the private package (Node ESM)', () => {
        const err = withCode(
            new Error("Cannot find package '@studio-saelix/sencho-pro' imported from /app/dist/entitlements/loadProvider.js"),
            'ERR_MODULE_NOT_FOUND',
        );
        expect(isProPackageNotInstalled(err)).toBe(true);
    });

    it('returns true for MODULE_NOT_FOUND on the private package (CJS / older Node)', () => {
        const err = withCode(
            new Error("Cannot find module '@studio-saelix/sencho-pro'"),
            'MODULE_NOT_FOUND',
        );
        expect(isProPackageNotInstalled(err)).toBe(true);
    });

    it('returns false for MODULE_NOT_FOUND on a transitive dep of the private package', () => {
        // The private package was installed but one of its dependencies is
        // missing. We must NOT classify this as "package not installed";
        // re-raising surfaces the bug instead of silently downgrading to
        // community.
        const err = withCode(
            new Error("Cannot find module 'axios'"),
            'MODULE_NOT_FOUND',
        );
        expect(isProPackageNotInstalled(err)).toBe(false);
    });

    it('returns false for ERR_PACKAGE_PATH_NOT_EXPORTED', () => {
        // Package was resolved but its exports map does not include the
        // path we asked for; this is a packaging bug, not a missing
        // package, and should re-raise.
        const err = withCode(
            new Error("Package subpath './internal' is not defined by exports in @studio-saelix/sencho-pro/package.json"),
            'ERR_PACKAGE_PATH_NOT_EXPORTED',
        );
        expect(isProPackageNotInstalled(err)).toBe(false);
    });

    it('returns false for an unrelated runtime error during construction', () => {
        // The package loaded successfully but threw inside its
        // constructor. The loader must re-raise; silently falling back
        // would be a license-bypass surface.
        const err = new TypeError('Cannot read property of undefined');
        expect(isProPackageNotInstalled(err)).toBe(false);
    });
});
