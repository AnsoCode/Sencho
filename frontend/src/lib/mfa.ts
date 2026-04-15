/**
 * MFA input helpers shared by the challenge screen and the MFA dialogs.
 *
 * The server is authoritative: it strips whitespace on TOTPs and calls
 * `MfaService.normalizeBackupCode` to accept backup codes with or without a
 * separator. We still normalize on the client so the input shows the user a
 * clean value, enforces a correct length cap, and stays consistent when a
 * code is pasted from a password manager (which may include smart-dashes,
 * line breaks, or trailing whitespace).
 */

/** Length of a raw backup code before any display formatting. */
export const BACKUP_CODE_RAW_LENGTH = 10;

/** Length of a backup code as displayed to the user: `ABCDE-FGHIJ`. */
export const BACKUP_CODE_DISPLAY_LENGTH = BACKUP_CODE_RAW_LENGTH + 1;

/** Length of the 6-digit TOTP used by every authenticator app we support. */
export const TOTP_LENGTH = 6;

/**
 * Normalize an incoming TOTP value to exactly the characters the server
 * will accept: digits only, capped at 6. Keeps typing fluid when a password
 * manager injects an extra space or the user pastes ` 123 456 `.
 */
export function normalizeTotpInput(raw: string): string {
    return (raw || '').replace(/\D+/g, '').slice(0, TOTP_LENGTH);
}

/**
 * Normalize an incoming backup code and produce a display-formatted value.
 *
 * - Uppercases everything (backup codes are printed in uppercase).
 * - Strips every character that is not `A-Z` or `0-9`, which drops spaces,
 *   line breaks, and any dash variant (`-`, en-dash, em-dash, figure-dash).
 * - Caps at 10 raw characters so `maxLength` never truncates a pasted value
 *   mid-character.
 * - Reintroduces a single `-` after the 5th character so the input mirrors
 *   the canonical `ABCDE-FGHIJ` layout users see in the enrolment dialog.
 */
export function normalizeBackupCodeInput(raw: string): { display: string; raw: string } {
    const stripped = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, BACKUP_CODE_RAW_LENGTH);
    if (stripped.length <= 5) return { display: stripped, raw: stripped };
    return { display: `${stripped.slice(0, 5)}-${stripped.slice(5)}`, raw: stripped };
}
