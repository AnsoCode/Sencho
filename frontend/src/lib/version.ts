/** Returns true when the string is a displayable semver version (not a placeholder or missing). */
export function isValidVersion(v: string | null | undefined): v is string {
  return !!v && v !== 'unknown' && v !== '0.0.0-dev' && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v);
}

/** Format a version string for display, returning null for invalid/missing values. */
export function formatVersion(v: string | null | undefined): string | null {
  if (!isValidVersion(v)) return null;
  return `v${v}`;
}
