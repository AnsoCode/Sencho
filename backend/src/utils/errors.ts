/**
 * Safely extract a message from an unknown caught value.
 *
 * Replaces the repeated `error instanceof Error ? error.message : '...'`
 * pattern throughout the codebase.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** True when `error` is a better-sqlite3 unique-constraint violation. */
export function isSqliteUniqueViolation(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}
