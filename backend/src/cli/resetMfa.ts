/**
 * Emergency CLI: clear a user's MFA enrolment from a shell inside the
 * container, used when the UI is unreachable (e.g. sole admin locked out
 * after losing their authenticator AND backup codes).
 *
 * Run via:
 *   docker compose exec sencho node dist/cli/resetMfa.js <username>
 *
 * The target's active sessions are invalidated by bumping `token_version`,
 * and the reset is written to the audit log with `actor: 'cli'`.
 */
import { DatabaseService } from '../services/DatabaseService';

export interface ResetMfaResult {
    ok: boolean;
    message: string;
}

/**
 * Import-friendly entry point for tests: resets MFA for `username` and
 * returns a structured result. The binary `main()` is a thin wrapper
 * around this.
 */
export function resetMfaForUser(username: string): ResetMfaResult {
    if (!username || typeof username !== 'string') {
        return { ok: false, message: 'Username is required' };
    }
    const db = DatabaseService.getInstance();
    const user = db.getUserByUsername(username);
    if (!user) {
        return { ok: false, message: `User not found: ${username}` };
    }
    db.deleteUserMfa(user.id);
    db.bumpTokenVersion(user.id);
    try {
        db.insertAuditLog({
            timestamp: Date.now(),
            username: 'cli',
            method: 'POST',
            path: `/cli/reset-mfa/${username}`,
            status_code: 200,
            node_id: null,
            ip_address: 'cli',
            summary: `CLI reset two-factor authentication for ${username}`,
        });
    } catch (err) {
        // Audit failure should not block the reset itself.
        console.warn('[reset-mfa] audit log write failed:', (err as Error).message);
    }
    return { ok: true, message: `Two-factor authentication cleared for ${username}` };
}

/** Binary entry: parse argv, run, exit with the right status code. */
function main(): void {
    const username = process.argv[2];
    if (!username) {
        console.error('Usage: node dist/cli/resetMfa.js <username>');
        process.exit(2);
    }
    const result = resetMfaForUser(username);
    if (result.ok) {
        console.log(result.message);
        process.exit(0);
    } else {
        console.error(result.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
