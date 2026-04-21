import { describe, it, expect } from 'vitest';
import { cveUrl } from '../cveUrl';

describe('cveUrl', () => {
  it('rewrites uppercase CVE IDs to cve.org', () => {
    expect(cveUrl('CVE-2024-1234')).toBe(
      'https://www.cve.org/CVERecord?id=CVE-2024-1234',
    );
  });

  it('rewrites lowercase CVE IDs uppercased', () => {
    expect(cveUrl('cve-2024-1234')).toBe(
      'https://www.cve.org/CVERecord?id=CVE-2024-1234',
    );
  });

  it('trims surrounding whitespace before rewriting', () => {
    expect(cveUrl('  CVE-2025-9999  ')).toBe(
      'https://www.cve.org/CVERecord?id=CVE-2025-9999',
    );
  });

  it('returns the fallback for GHSA advisory IDs', () => {
    const ghsa = 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz';
    expect(cveUrl('GHSA-xxxx-yyyy-zzzz', ghsa)).toBe(ghsa);
  });

  it('returns the fallback for AVD misconfig IDs', () => {
    const avd = 'https://avd.aquasec.com/misconfig/ds002';
    expect(cveUrl('AVD-DS-0002', avd)).toBe(avd);
  });

  it('returns the fallback when id is null', () => {
    expect(cveUrl(null, 'https://example.test/advisory')).toBe(
      'https://example.test/advisory',
    );
  });

  it('returns null when id is undefined and no fallback', () => {
    expect(cveUrl(undefined)).toBeNull();
  });

  it('returns null when id is empty and no fallback', () => {
    expect(cveUrl('')).toBeNull();
  });

  it('returns null when id is empty and fallback is null', () => {
    expect(cveUrl('', null)).toBeNull();
  });
});
