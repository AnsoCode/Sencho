import os from 'os';
import path from 'path';

/**
 * Constants shared between vitestGlobalSetup (which builds the baseline
 * test DB once) and setupTestDb (which copies the baseline per file).
 * Kept in their own module so both can import without circular deps.
 */

export const TEST_USERNAME = 'testadmin';
export const TEST_PASSWORD = 'testpassword123';
// Fixed across the suite so JWT signing/verifying lines up between the
// admin user seeded in the baseline and tests that sign tokens directly.
// 64 hex chars matches the shape of a real JWT_SECRET produced by
// crypto.randomBytes(32).toString('hex'); the value itself is not secret.
export const TEST_JWT_SECRET =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export const BASELINE_DIR = path.join(os.tmpdir(), 'sencho-test-baseline');
export const BASELINE_DB_PATH = path.join(BASELINE_DIR, 'sencho.db');
