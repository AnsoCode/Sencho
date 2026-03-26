/**
 * Test DB helper — creates a temporary SQLite database, seeds it with a known
 * admin credential, and sets process.env so DatabaseService uses it.
 *
 * Call this at the top of every test file *before* importing the app,
 * because DatabaseService initialises its path on first getInstance() call.
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

export const TEST_USERNAME = 'testadmin';
export const TEST_PASSWORD = 'testpassword123';
export let TEST_JWT_SECRET = '';

export async function setupTestDb(): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sencho-test-'));
  process.env.DATA_DIR = tmpDir;
  // Also point COMPOSE_DIR to a temp dir so FileSystemService doesn't fail on missing dir
  const composeDir = path.join(tmpDir, 'compose');
  fs.mkdirSync(composeDir, { recursive: true });
  process.env.COMPOSE_DIR = composeDir;

  // Initialise the DB (singleton will use DATA_DIR we just set)
  const { DatabaseService } = await import('../../services/DatabaseService');
  const db = DatabaseService.getInstance();

  // Seed admin credentials
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 1); // cost=1 for speed in tests
  TEST_JWT_SECRET = crypto.randomBytes(32).toString('hex');
  db.updateGlobalSetting('auth_username', TEST_USERNAME);
  db.updateGlobalSetting('auth_password_hash', passwordHash);
  db.updateGlobalSetting('auth_jwt_secret', TEST_JWT_SECRET);

  // Also seed the users table (RBAC login reads from here)
  db.addUser({ username: TEST_USERNAME, password_hash: passwordHash, role: 'admin' });

  return tmpDir;
}

export function cleanupTestDb(tmpDir: string): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}
