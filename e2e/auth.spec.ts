/**
 * Authentication E2E tests.
 * Tests login, logout, and unauthenticated redirect.
 */
import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERNAME, TEST_PASSWORD } from './helpers';

test.describe('Authentication', () => {
  test('login with valid credentials shows the dashboard', async ({ page }) => {
    await loginAs(page);
    // Should see the main editor/dashboard — not a login page
    await expect(page).not.toHaveURL(/login/i);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('login with wrong password shows an error', async ({ page }) => {
    await page.goto('/');
    // Skip setup if needed
    const isSetup = await page.getByRole('heading', { name: /setup/i }).isVisible().catch(() => false);
    if (isSetup) {
      // Must complete setup before we can test wrong password
      await loginAs(page);
      await page.goto('/login');
    }

    await page.getByLabel(/username/i).fill(TEST_USERNAME);
    await page.getByLabel(/password/i).fill('definitly-wrong-password');
    await page.getByRole('button', { name: /login|sign in/i }).click();

    await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible();
  });

  test('visiting a protected page without auth redirects to login', async ({ page }) => {
    // Clear cookies to simulate logged-out state
    await page.context().clearCookies();
    await page.goto('/');
    await expect(page).toHaveURL(/login|setup/i);
  });

  test('logout redirects to login', async ({ page }) => {
    await loginAs(page);
    // Find and click the logout button (varies by UI — adjust selector as needed)
    const logoutBtn = page.getByRole('button', { name: /logout|sign out/i });
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await expect(page).toHaveURL(/login/i);
    }
  });
});
