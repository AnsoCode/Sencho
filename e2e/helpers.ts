/**
 * Shared helpers for E2E tests.
 *
 * The dev backend must be running at localhost:3000 and seeded via the setup flow,
 * OR use a fixed set of test credentials.
 */
import { Page, expect } from '@playwright/test';

export const TEST_USERNAME = process.env.E2E_USERNAME ?? 'admin';
export const TEST_PASSWORD = process.env.E2E_PASSWORD ?? 'password123';

/** Navigate to app, complete setup if needed, then log in. */
export async function loginAs(page: Page, username = TEST_USERNAME, password = TEST_PASSWORD) {
  await page.goto('/');

  // If setup page is shown, complete it first
  const isSetup = await page.getByRole('heading', { name: /setup/i }).isVisible().catch(() => false);
  if (isSetup) {
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/^password$/i).fill(password);
    const confirmInput = page.getByLabel(/confirm password/i);
    if (await confirmInput.isVisible()) await confirmInput.fill(password);
    await page.getByRole('button', { name: /create account|setup|submit/i }).click();
    await page.waitForURL(/login|dashboard|\//);
  }

  // Login if redirected to login page
  const isLogin = await page.getByRole('heading', { name: /login|sign in/i }).isVisible().catch(() => false);
  if (isLogin) {
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    // Wait for the dashboard to load
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10_000 });
  }
}
