/**
 * Two-factor authentication (TOTP) E2E tests.
 *
 * These tests run serially and share mutable state (the enrolment secret and
 * the freshly issued backup codes). The chain is:
 *   1. Enrol via the Account section, capture secret and backup codes from the
 *      network responses so we do not have to scrape the DOM.
 *   2. Log out, log back in, satisfy the TOTP challenge, land on the dashboard.
 *   3. Log out, log back in, satisfy the challenge with a backup code,
 *      re-use the same backup code and confirm the second attempt fails.
 *   4. Disable 2FA to leave the dev DB in a clean state for the next run.
 *
 * If a previous run aborted mid-way, the test user may already have MFA on.
 * Run `node backend/dist/cli/resetMfa.js <username>` or wipe the dev DB first.
 */
import { test, expect, Page } from '@playwright/test';
import { loginAs, totpNow, TEST_USERNAME, TEST_PASSWORD, isDashboard } from './helpers';

async function logout(page: Page) {
  await page.getByRole('button', { name: /profile/i }).click();
  await page.getByRole('button', { name: /log out/i }).click();
  // The MfaChallenge / Login screen has no dashboard indicator.
  await expect.poll(async () => isDashboard(page), { timeout: 5_000 }).toBe(false);
}

async function openAccountSettings(page: Page) {
  await page.getByRole('button', { name: /profile/i }).click();
  await page.getByRole('button', { name: /settings/i }).click();
  await expect(page.getByRole('heading', { name: /Account & Security/i })).toBeVisible();
}

/** Fill a login form (no MFA branch). */
async function fillLoginForm(page: Page, username: string, password: string) {
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('button:has-text("Login"), button:has-text("Sign in")').first().click();
}

test.describe.serial('Two-factor authentication', () => {
  let secret = '';
  let backupCodes: string[] = [];

  // Safety net: if any test above fails, Playwright skips the rest of the
  // serial block, so the "disable 2FA" test never runs and the shared test
  // user stays MFA-enabled in the dev DB. That wrecks every subsequent spec
  // (nodes, stacks, screenshots) because their loginAs helper does not know
  // about the challenge screen. afterAll always runs, so we clear MFA here
  // via the API using whatever enrolment state we captured.
  test.afterAll(async ({ request }) => {
    if (!secret || backupCodes.length < 2) return;
    try {
      // Use backup codes for both steps: they are single-use and sidestep
      // the TOTP replay blacklist, so we do not need to reason about which
      // 30-second window we are currently in.
      const loginBackup = backupCodes[backupCodes.length - 2];
      const disableBackup = backupCodes[backupCodes.length - 1];
      await request.post('/api/auth/login', {
        data: { username: TEST_USERNAME, password: TEST_PASSWORD },
      });
      const loginRes = await request.post('/api/auth/login/mfa', {
        data: { code: loginBackup, isBackupCode: true },
      });
      if (!loginRes.ok()) return;
      await request.post('/api/auth/mfa/disable', {
        data: { code: disableBackup, isBackupCode: true },
      });
    } catch {
      // Best effort; if this fails the next full-suite run will need a
      // manual DB wipe or CLI reset.
    }
  });

  test('enrol from Account settings captures secret and backup codes', async ({ page }) => {
    await loginAs(page, TEST_USERNAME, TEST_PASSWORD);
    await openAccountSettings(page);

    // Capture the raw base32 secret from the enroll/start response so we
    // do not need to strip formatting spaces off the DOM value.
    const startPromise = page.waitForResponse(
      (r) => r.url().includes('/api/auth/mfa/enroll/start') && r.status() === 200,
    );
    await page.getByRole('button', { name: /Set up 2FA/i }).click();
    const startRes = await startPromise;
    const startBody = await startRes.json();
    secret = startBody.secret;
    expect(secret).toMatch(/^[A-Z2-7]+$/); // base32 alphabet

    // Step 1 (QR) -> Next
    await page.getByRole('button', { name: /^Next$/ }).click();

    // Step 2 (Confirm): enter a fresh TOTP and capture the backup codes.
    const confirmPromise = page.waitForResponse(
      (r) => r.url().includes('/api/auth/mfa/enroll/confirm') && r.status() === 200,
    );
    await page.locator('#mfa-confirm-code').fill(totpNow(secret));
    await page.getByRole('button', { name: /^Verify$/ }).click();
    const confirmRes = await confirmPromise;
    const confirmBody = await confirmRes.json();
    backupCodes = confirmBody.backupCodes;
    expect(backupCodes.length).toBe(10);

    // Step 3 (Backup codes) -> acknowledge.
    await page.getByRole('button', { name: /saved these/i }).click();

    // Card now shows the Enabled badge.
    await expect(page.getByText(/^Enabled$/)).toBeVisible();
  });

  test('login with a valid TOTP code reaches the dashboard', async ({ page }) => {
    // Fresh page lands on the login screen; password passes but the MFA
    // challenge appears because test #1 enrolled the user.
    await page.goto('/');
    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });
    await fillLoginForm(page, TEST_USERNAME, TEST_PASSWORD);
    await expect(page.getByRole('heading', { name: /Two-factor authentication/i })).toBeVisible();

    await page.locator('#mfa-code').fill(totpNow(secret));
    await page.getByRole('button', { name: /Verify and sign in/i }).click();

    await expect.poll(async () => isDashboard(page), { timeout: 10_000 }).toBe(true);
  });

  test('backup code works once and cannot be replayed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });

    const code = backupCodes[0];
    expect(code).toBeTruthy();

    // First use: should succeed.
    await fillLoginForm(page, TEST_USERNAME, TEST_PASSWORD);
    await expect(page.getByRole('heading', { name: /Two-factor authentication/i })).toBeVisible();
    await page.getByRole('button', { name: /Use a backup code instead/i }).click();
    await page.locator('#mfa-code').fill(code);
    await page.getByRole('button', { name: /Verify and sign in/i }).click();
    await expect.poll(async () => isDashboard(page), { timeout: 10_000 }).toBe(true);

    // Log out and try the same backup code again: should fail.
    await logout(page);
    await fillLoginForm(page, TEST_USERNAME, TEST_PASSWORD);
    await expect(page.getByRole('heading', { name: /Two-factor authentication/i })).toBeVisible();
    await page.getByRole('button', { name: /Use a backup code instead/i }).click();
    await page.locator('#mfa-code').fill(code);
    await page.getByRole('button', { name: /Verify and sign in/i }).click();

    // Error should be visible and we should still be on the challenge screen.
    await expect(page.locator('.text-destructive')).toBeVisible();
    expect(await isDashboard(page)).toBe(false);

    // Recover using a fresh backup code. Using a TOTP here races the
    // 30-second window against the one test #2 consumed, which the server
    // (correctly) rejects as a replay when the boundary falls the wrong
    // way. Backup codes are single-use and sidestep that blacklist.
    await page.locator('#mfa-code').clear();
    await page.locator('#mfa-code').fill(backupCodes[1]);
    await page.getByRole('button', { name: /Verify and sign in/i }).click();
    await expect.poll(async () => isDashboard(page), { timeout: 10_000 }).toBe(true);
  });

  test('disable 2FA with a valid code removes the challenge on next login', async ({ page }) => {
    await loginAs(page, TEST_USERNAME, TEST_PASSWORD);
    await openAccountSettings(page);

    await page.getByRole('button', { name: /Disable 2FA/i }).click();
    await page.locator('#mfa-disable-code').fill(totpNow(secret));
    await page.getByRole('button', { name: /^Disable$/ }).click();

    // Card flips back to the "Set up 2FA" call to action.
    await expect(page.getByRole('button', { name: /Set up 2FA/i })).toBeVisible();

    // Close settings, log out, log back in without the MFA challenge.
    await page.keyboard.press('Escape').catch(() => {});
    await logout(page);
    await fillLoginForm(page, TEST_USERNAME, TEST_PASSWORD);
    await expect.poll(async () => isDashboard(page), { timeout: 10_000 }).toBe(true);
  });
});
