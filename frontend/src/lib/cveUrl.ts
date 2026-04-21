const CVE_PATTERN = /^cve-\d{4}-\d+$/i;

/**
 * Trivy's PrimaryURL is usually https://avd.aquasec.com/nvd/<id>, which 404s.
 * For CVE-prefixed IDs we rewrite to cve.org. GHSA, AVD-misconfig, and other
 * identifiers keep the Trivy-supplied fallback.
 */
export function cveUrl(
  id: string | null | undefined,
  fallback?: string | null,
): string | null {
  if (!id) return fallback ?? null;
  const trimmed = id.trim();
  if (CVE_PATTERN.test(trimmed)) {
    return `https://www.cve.org/CVERecord?id=${trimmed.toUpperCase()}`;
  }
  return fallback ?? null;
}
