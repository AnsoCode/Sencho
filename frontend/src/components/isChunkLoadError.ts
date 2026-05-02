/**
 * Recognises the error messages browsers throw when a dynamically-imported
 * chunk URL is no longer reachable. Each runtime worded the failure
 * differently, so the heuristic is a substring union rather than a single
 * regex; broadening to a generic "module + fail" match would over-fire on
 * legitimate runtime errors and route them to a misleading Reload CTA.
 *
 * Currently covered:
 *   - Chrome / Edge:  "Failed to fetch dynamically imported module: <url>"
 *   - Safari:         "Importing a module script failed."
 *   - Firefox:        "Loading module from \"<url>\" was blocked because of a disallowed MIME type (\"text/html\")."
 *                     (fired when a deploy serves the SPA index.html for a missing chunk URL)
 *   - Older Webpack:  "Error loading dynamically imported module"
 *   - Vite:           "Loading chunk N failed." / "Loading CSS chunk N failed"
 *
 * Add new substrings here as new browser variants surface; cover them in
 * the matching unit test so a regression in one runtime is caught early.
 */
export function isChunkLoadError(error: Error | null | undefined): boolean {
    if (!error) return false;
    const msg = error.message.toLowerCase();
    return (
        msg.includes('failed to fetch dynamically imported module') ||
        msg.includes('importing a module script failed') ||
        msg.includes('error loading dynamically imported module') ||
        msg.includes('disallowed mime type') ||
        msg.includes('loading chunk') ||
        msg.includes('loading css chunk')
    );
}
