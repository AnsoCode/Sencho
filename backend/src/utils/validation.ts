import path from 'path';

/**
 * Stack name must only contain URL-safe characters with no path separators.
 * Prevents path-traversal attacks when the name is used to build filesystem paths.
 */
export const isValidStackName = (name: string): boolean =>
  /^[a-zA-Z0-9_-]+$/.test(name);

/**
 * Validates that a remote node API URL is a safe, well-formed HTTP/HTTPS URL.
 * Rejects loopback addresses to prevent SSRF against local services.
 * Private/LAN IPs are allowed — users legitimately point Sencho at nodes on their LAN.
 */
export function isValidRemoteUrl(
  raw: string,
): { valid: true; url: URL } | { valid: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      valid: false,
      reason: 'API URL must be a valid URL (e.g. https://my-server.example.com:3000)',
    };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { valid: false, reason: 'API URL must use http:// or https://' };
  }
  // Node.js URL API preserves brackets for IPv6: new URL('http://[::1]').hostname === '[::1]'
  const loopback = /^(localhost|127(\.\d+){3}|\[::1\]|0\.0\.0\.0)$/i;
  if (loopback.test(url.hostname)) {
    return {
      valid: false,
      reason: 'API URL cannot point to localhost or loopback — use the actual host address',
    };
  }
  return { valid: true, url };
}

/**
 * Asserts that a resolved file path stays within a given base directory.
 * Returns true if the path is safe, false if it escapes the base.
 */
export function isPathWithinBase(resolvedPath: string, baseDir: string): boolean {
  const normalizedBase = path.resolve(baseDir);
  const normalizedPath = path.resolve(resolvedPath);
  return (
    normalizedPath === normalizedBase ||
    normalizedPath.startsWith(normalizedBase + path.sep)
  );
}
