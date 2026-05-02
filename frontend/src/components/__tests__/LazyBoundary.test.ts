import { describe, it, expect } from 'vitest';
import { isChunkLoadError } from '../LazyBoundary';

/**
 * isChunkLoadError is a substring union over the messages browsers emit
 * when a dynamically-imported chunk URL is no longer reachable. The heuristic
 * is the entire feature: a missed variant routes a stale-tab user to a
 * misleading "Try again" CTA instead of "Reload", and "Try again" can never
 * succeed against a chunk URL that no longer exists. Keep this fixture in
 * sync with the documented browser variants in LazyBoundary.tsx.
 */
describe('isChunkLoadError', () => {
    it('returns false for null', () => {
        expect(isChunkLoadError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isChunkLoadError(undefined)).toBe(false);
    });

    it('returns false for unrelated runtime errors', () => {
        expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
        expect(isChunkLoadError(new Error('Maximum update depth exceeded'))).toBe(false);
        expect(isChunkLoadError(new Error('Network request failed'))).toBe(false);
    });

    it('matches Chrome / Edge "Failed to fetch dynamically imported module"', () => {
        const err = new Error('Failed to fetch dynamically imported module: https://app.example/assets/FleetView-abc123.js');
        expect(isChunkLoadError(err)).toBe(true);
    });

    it('matches Safari "Importing a module script failed."', () => {
        expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    });

    it('matches Firefox MIME-type variant produced when a deploy serves index.html for a missing chunk', () => {
        const err = new Error(
            'Loading module from "https://app.example/assets/FleetView-abc123.js" was blocked because of a disallowed MIME type ("text/html").',
        );
        expect(isChunkLoadError(err)).toBe(true);
    });

    it('matches older Webpack "Error loading dynamically imported module"', () => {
        expect(isChunkLoadError(new Error('Error loading dynamically imported module'))).toBe(true);
    });

    it('matches Vite "Loading chunk N failed."', () => {
        expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true);
    });

    it('matches Vite "Loading CSS chunk N failed"', () => {
        expect(isChunkLoadError(new Error('Loading CSS chunk 42 failed'))).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isChunkLoadError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'))).toBe(true);
        expect(isChunkLoadError(new Error('Loading Chunk 12 Failed'))).toBe(true);
    });
});
