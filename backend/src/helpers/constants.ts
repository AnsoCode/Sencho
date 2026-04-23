// Shared constants used across the backend. Extracted from index.ts to keep
// the entry point lean and to make values discoverable without scanning the
// monolith.

// Server
export const PORT = 3000;

// Password policy
export const MIN_PASSWORD_LENGTH = 8;

// Labels
export const VALID_LABEL_COLORS = ['teal', 'blue', 'purple', 'rose', 'amber', 'green', 'orange', 'pink', 'cyan', 'slate'] as const;
export type LabelColor = typeof VALID_LABEL_COLORS[number];
export const MAX_LABELS_PER_NODE = 50;

// Session cookies
export const COOKIE_NAME = 'sencho_token';
export const SESSION_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MFA_PENDING_COOKIE_NAME = 'sencho_mfa_pending';
export const MFA_PENDING_SCOPE = 'mfa_pending';
export const MFA_PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete the challenge

// Hot-path cache TTLs.
// Short TTLs collapse concurrent polling pressure across browser tabs and
// overlapping service samplers without introducing noticeable UI staleness.
// Keys are per-node: "stats:<nodeId>", "system-stats:<nodeId>", "stack-statuses:<nodeId>".
export const STATS_CACHE_TTL_MS = 2_000;
export const SYSTEM_STATS_CACHE_TTL_MS = 3_000;
export const STACK_STATUSES_CACHE_TTL_MS = 3_000;
