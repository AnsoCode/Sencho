import fs from 'fs';
import bcrypt from 'bcrypt';
import {
  TEST_USERNAME,
  TEST_PASSWORD,
  TEST_JWT_SECRET,
  BASELINE_DIR,
} from './testConstants';

/**
 * Vitest global setup: build the baseline test DB once before any worker
 * runs. Each test file's setupTestDb() then copies this file into its own
 * temp dir instead of paying the schema-init + migrate*() + bcrypt.hash +
 * seed-insert cost N times. DatabaseService.getInstance() in the worker
 * opens the existing baseline; the constructor's CREATE TABLE IF NOT
 * EXISTS and idempotent migrate*() methods (per CLAUDE.md guarantee)
 * collapse to no-ops.
 */
export default async function setup(): Promise<void> {
  if (fs.existsSync(BASELINE_DIR)) {
    fs.rmSync(BASELINE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BASELINE_DIR, { recursive: true });

  const prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = BASELINE_DIR;
  try {
    const { DatabaseService } = await import('../../services/DatabaseService');
    const db = DatabaseService.getInstance();

    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 1);
    db.updateGlobalSetting('auth_username', TEST_USERNAME);
    db.updateGlobalSetting('auth_password_hash', passwordHash);
    db.updateGlobalSetting('auth_jwt_secret', TEST_JWT_SECRET);
    db.addUser({ username: TEST_USERNAME, password_hash: passwordHash, role: 'admin' });

    // Flush the file so workers see a complete DB on copy.
    db.getDb().close();
  } finally {
    // Restore env so workers do not inherit DATA_DIR pointing at the
    // shared baseline. setupTestDb overrides it per file regardless,
    // but defense-in-depth against an early DatabaseService import.
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
  }
}

export function teardown(): void {
  if (fs.existsSync(BASELINE_DIR)) {
    fs.rmSync(BASELINE_DIR, { recursive: true, force: true });
  }
}
