/**
 * Shared helpers for Sencho E2E tests.
 *
 * CREDENTIALS: Set E2E_USERNAME and E2E_PASSWORD env vars to match
 * your dev instance's admin account. Defaults assume the initial setup
 * was completed with username "admin" and password "password123".
 *
 *   E2E_USERNAME=admin E2E_PASSWORD=mypassword npx playwright test
 */
import { Page, expect } from '@playwright/test';

export const TEST_USERNAME = process.env.E2E_USERNAME ?? 'admin';
export const TEST_PASSWORD = process.env.E2E_PASSWORD ?? 'password123';

/** Selector for the dashboard - only present in EditorLayout, not on login/setup pages */
const DASHBOARD_INDICATOR = 'img[alt="Sencho Logo"]';

/** Returns true if the current page is the first-run setup screen */
async function isSetupPage(page: Page): Promise<boolean> {
  return page.locator('#confirmPassword, input[placeholder*="Confirm"]').isVisible().catch(() => false);
}

/** Returns true if the current page is the login screen */
async function isLoginPage(page: Page): Promise<boolean> {
  return page.locator('button:has-text("Login"), button:has-text("Sign in")').isVisible().catch(() => false);
}

/** Returns true if the dashboard (EditorLayout) is loaded */
export async function isDashboard(page: Page): Promise<boolean> {
  return page.locator(DASHBOARD_INDICATOR).isVisible().catch(() => false);
}

/**
 * Navigate to the app root, complete first-run setup if needed, then log in.
 * After this call the dashboard is guaranteed to be visible.
 */
export async function loginAs(page: Page, username = TEST_USERNAME, password = TEST_PASSWORD) {
  await page.goto('/');

  // Wait for the app to finish its auth check (loading spinner disappears)
  await page.waitForTimeout(500);

  // ── First-run setup ───────────────────────────────────────────────────────
  if (await isSetupPage(page)) {
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    const confirmInput = page.locator('#confirmPassword');
    if (await confirmInput.isVisible()) await confirmInput.fill(password);
    await page.locator('button[type="submit"]').click();
    // After setup, the app logs in automatically and shows the dashboard
    await expect(page.locator(DASHBOARD_INDICATOR)).toBeVisible({ timeout: 10_000 });
    return;
  }

  // ── Login screen ─────────────────────────────────────────────────────────
  if (await isLoginPage(page)) {
    await page.locator('#username').fill(username);
    await page.locator('#password').fill(password);
    await page.locator('button:has-text("Login"), button:has-text("Sign in")').first().click();
    await expect(page.locator(DASHBOARD_INDICATOR)).toBeVisible({ timeout: 10_000 });
    return;
  }

  // ── Already on the dashboard ──────────────────────────────────────────────
  if (await isDashboard(page)) {
    return;
  }

  throw new Error(
    'loginAs: could not determine page state - expected setup, login, or dashboard. ' +
    'Check that E2E_USERNAME and E2E_PASSWORD are set correctly.',
  );
}
