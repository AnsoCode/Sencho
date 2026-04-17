/**
 * Read-time CVE suppression filter.
 *
 * Suppressions never modify stored scan rows. They are applied at read time so
 * toggling them off resurfaces findings without rescanning.
 *
 * A suppression matches a finding when:
 *   - cve_id equals the finding's vulnerability_id, AND
 *   - pkg_name is null OR equals the finding's pkg_name, AND
 *   - image_pattern is null OR matches the image reference (glob), AND
 *   - expires_at is null OR still in the future.
 */
import type { CveSuppression } from '../services/DatabaseService';

export interface SuppressionDecision {
    suppressed: boolean;
    suppression_id?: number;
    suppression_reason?: string;
}

export interface SuppressibleFinding {
    vulnerability_id: string;
    pkg_name: string;
}

function matchesImagePattern(pattern: string | null, imageRef: string): boolean {
    if (!pattern) return true;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(imageRef);
}

function isActive(suppression: CveSuppression, now: number): boolean {
    return suppression.expires_at === null || suppression.expires_at > now;
}

/**
 * Find the most specific active suppression matching a single finding.
 * Specificity: entries that pin a specific pkg or image beat wildcard entries.
 */
export function findSuppression(
    finding: SuppressibleFinding,
    imageRef: string,
    suppressions: CveSuppression[],
    now: number = Date.now(),
): CveSuppression | null {
    const matches = suppressions.filter((s) => {
        if (!isActive(s, now)) return false;
        if (s.cve_id !== finding.vulnerability_id) return false;
        if (s.pkg_name !== null && s.pkg_name !== finding.pkg_name) return false;
        if (!matchesImagePattern(s.image_pattern, imageRef)) return false;
        return true;
    });
    if (matches.length === 0) return null;
    const score = (s: CveSuppression): number =>
        (s.pkg_name ? 2 : 0) + (s.image_pattern ? 1 : 0);
    matches.sort((a, b) => score(b) - score(a));
    return matches[0];
}

/**
 * Enrich a list of findings with suppression decisions. Does not mutate inputs.
 */
export function applySuppressions<T extends SuppressibleFinding>(
    findings: T[],
    imageRef: string,
    suppressions: CveSuppression[],
    now: number = Date.now(),
): Array<T & SuppressionDecision> {
    return findings.map((f) => {
        const match = findSuppression(f, imageRef, suppressions, now);
        if (!match) return { ...f, suppressed: false };
        return {
            ...f,
            suppressed: true,
            suppression_id: match.id,
            suppression_reason: match.reason,
        };
    });
}
