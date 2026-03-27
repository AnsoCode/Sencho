/**
 * Authentication E2E tests.
 * Tests login, logout, and unauthenticated redirect.
 */
import { test, expect } from '@playwright/test';
import { loginAs, isDashboard, TEST_USERNAME, TEST_PASSWORD } from './helpers';

test.describe('Authentication', () => {
  test('login with valid credentials shows the dashboard', async ({ page }) => {
    await loginAs(page, TEST_USERNAME, TEST_PASSWORD);
    expect(await isDashboard(page)).toBe(true);
    // URL should not be on a login page
    expect(page.url()).not.toMatch(/login/i);
  });

  test('login with wrong password shows an error', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);

    // Skip if already logged in
    if (await isDashboard(page)) {
      await page.context().clearCookies();
      await page.reload();
      await page.waitForTimeout(500);
    }

    await page.locator('#username').fill(TEST_USERNAME);
    await page.locator('#password').fill('definitely-wrong-password-xyz');
    await page.locator('button:has-text("Login"), button:has-text("Sign in")').first().click();

    // Should show error message, not navigate to dashboard
    await expect(page.locator('text=/invalid|incorrect|wrong|failed/i')).toBeVisible({ timeout: 5_000 });
    expect(await isDashboard(page)).toBe(false);
  });

  test('visiting the app without auth redirects to login', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/');
    await page.waitForTimeout(1_000);

    // Should be on login or setup, not dashboard
    expect(await isDashboard(page)).toBe(false);
    // Login button or setup form should be visible
    const loginOrSetup = await page.locator(
      'button:has-text("Login"), button:has-text("Sign in"), button[type="submit"]'
    ).first().isVisible();
    expect(loginOrSetup).toBe(true);
  });

  test('logout returns to the login screen', async ({ page }) => {
    await loginAs(page);
    // Log Out is inside the User Profile Dropdown - open it first
    await page.getByRole('button', { name: /profile/i }).click();
    await page.getByRole('button', { name: /log out/i }).click();
    await page.waitForTimeout(1_000);
    expect(await isDashboard(page)).toBe(false);
  });
});
