/**
 * Safely extract a message from an unknown caught value.
 *
 * Replaces the repeated `error instanceof Error ? error.message : '...'`
 * pattern throughout the codebase.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
