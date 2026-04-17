/**
 * Unit tests for the read-time CVE suppression filter.
 */
import { describe, it, expect } from 'vitest';
import { applySuppressions, findSuppression } from '../utils/suppression-filter';
import type { CveSuppression } from '../services/DatabaseService';

const NOW = 1_700_000_000_000;

function makeSuppression(overrides: Partial<CveSuppression> = {}): CveSuppression {
  return {
    id: 1,
    cve_id: 'CVE-2024-1234',
    pkg_name: null,
    image_pattern: null,
    reason: 'known false positive',
    created_by: 'admin',
    created_at: NOW - 1000,
    expires_at: null,
    replicated_from_control: 0,
    ...overrides,
  };
}

describe('findSuppression', () => {
  it('returns null when no suppression exists for the CVE', () => {
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-9999', pkg_name: 'openssl' },
      'nginx:1.25',
      [makeSuppression({ cve_id: 'CVE-2024-1234' })],
      NOW,
    );
    expect(match).toBeNull();
  });

  it('matches a fleet-wide suppression (null pkg, null pattern)', () => {
    const s = makeSuppression({ id: 42 });
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'openssl' },
      'nginx:1.25',
      [s],
      NOW,
    );
    expect(match?.id).toBe(42);
  });

  it('does not match a suppression pinned to a different pkg', () => {
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'glibc' },
      'nginx:1.25',
      [makeSuppression({ pkg_name: 'openssl' })],
      NOW,
    );
    expect(match).toBeNull();
  });

  it('ignores expired suppressions', () => {
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'openssl' },
      'nginx:1.25',
      [makeSuppression({ expires_at: NOW - 1 })],
      NOW,
    );
    expect(match).toBeNull();
  });

  it('accepts suppressions with expires_at in the future', () => {
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'openssl' },
      'nginx:1.25',
      [makeSuppression({ id: 7, expires_at: NOW + 10_000 })],
      NOW,
    );
    expect(match?.id).toBe(7);
  });

  it('matches wildcard image_pattern via *', () => {
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'openssl' },
      'registry.example.com/nginx:1.25',
      [makeSuppression({ image_pattern: '*nginx*' })],
      NOW,
    );
    expect(match).not.toBeNull();
  });

  it('does not match an image_pattern with no wildcards unless exact', () => {
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'openssl' },
      'nginx:1.25-alpine',
      [makeSuppression({ image_pattern: 'nginx:1.25' })],
      NOW,
    );
    expect(match).toBeNull();
  });

  it('escapes regex metacharacters in image_pattern', () => {
    // The + should be literal; otherwise "a+" would match "aa"
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'openssl' },
      'aa',
      [makeSuppression({ image_pattern: 'a+' })],
      NOW,
    );
    expect(match).toBeNull();
  });

  it('prefers pkg-specific suppression over wildcard', () => {
    const wildcard = makeSuppression({ id: 1, pkg_name: null });
    const specific = makeSuppression({ id: 2, pkg_name: 'openssl' });
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'openssl' },
      'nginx:1.25',
      [wildcard, specific],
      NOW,
    );
    expect(match?.id).toBe(2);
  });

  it('prefers image-pattern + pkg over pkg-only', () => {
    const pkgOnly = makeSuppression({ id: 1, pkg_name: 'openssl' });
    const both = makeSuppression({ id: 2, pkg_name: 'openssl', image_pattern: 'nginx*' });
    const match = findSuppression(
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'openssl' },
      'nginx:1.25',
      [pkgOnly, both],
      NOW,
    );
    expect(match?.id).toBe(2);
  });
});

describe('applySuppressions', () => {
  it('enriches findings without mutating inputs', () => {
    const findings = [
      { vulnerability_id: 'CVE-2024-1234', pkg_name: 'openssl', severity: 'HIGH' },
      { vulnerability_id: 'CVE-2024-9999', pkg_name: 'glibc', severity: 'LOW' },
    ];
    const result = applySuppressions(
      findings,
      'nginx:1.25',
      [makeSuppression({ id: 5, reason: 'accepted risk' })],
      NOW,
    );

    expect(result[0]).toMatchObject({
      vulnerability_id: 'CVE-2024-1234',
      severity: 'HIGH',
      suppressed: true,
      suppression_id: 5,
      suppression_reason: 'accepted risk',
    });
    expect(result[1]).toMatchObject({
      vulnerability_id: 'CVE-2024-9999',
      suppressed: false,
    });
    expect(result[1].suppression_id).toBeUndefined();
    // Original findings untouched
    expect(findings[0]).not.toHaveProperty('suppressed');
  });

  it('returns an empty array for empty input', () => {
    expect(applySuppressions([], 'nginx:1.25', [], NOW)).toEqual([]);
  });
});
