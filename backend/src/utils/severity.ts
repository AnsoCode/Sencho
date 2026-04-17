import type { VulnSeverity } from '../services/DatabaseService';

export const SEVERITY_ORDER: VulnSeverity[] = [
    'UNKNOWN',
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL',
];

export function severityRank(severity: VulnSeverity | null | undefined): number {
    if (!severity) return -1;
    return SEVERITY_ORDER.indexOf(severity);
}

export function isSeverityAtLeast(
    actual: VulnSeverity | null | undefined,
    threshold: VulnSeverity,
): boolean {
    return severityRank(actual) >= severityRank(threshold);
}
