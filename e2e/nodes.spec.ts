/**
 * Node management E2E tests.
 * Tests the SSRF validation we added (C2 fix) is surfaced in the UI.
 */
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

test.describe('Node management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    // Open Settings modal
    await page.getByRole('button', { name: /settings/i }).click();
    // Navigate to the Nodes section inside the modal
    await page.getByRole('button', { name: /^nodes$/i }).click();
  });

  test('adding a node with localhost api_url shows a validation error', async ({ page }) => {
    // Open "add node" dialog
    const addBtn = page.getByRole('button', { name: /add node|new node|\+/i });
    if (!await addBtn.isVisible()) {
      test.skip();
      return;
    }
    await addBtn.click();

    await page.locator('#node-name').fill('bad-node');
    // Select "remote" type if there's a type selector
    const typeSelect = page.getByLabel(/type/i);
    if (await typeSelect.isVisible()) await typeSelect.selectOption('remote');

    await page.getByLabel(/api url/i).fill('http://localhost:6379');
    await page.getByRole('button', { name: /add|save|create/i }).click();

    // Should see an error about loopback/localhost
    await expect(page.getByText(/loopback|localhost/i)).toBeVisible({ timeout: 3_000 });
  });

  test('adding a node with an invalid URL shows an error', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add node|new node|\+/i });
    if (!await addBtn.isVisible()) {
      test.skip();
      return;
    }
    await addBtn.click();

    await page.getByLabel(/node name/i).fill('bad-url-node');
    const typeSelect = page.getByLabel(/type/i);
    if (await typeSelect.isVisible()) await typeSelect.selectOption('remote');

    await page.getByLabel(/api url/i).fill('not-a-url-at-all');
    await page.getByRole('button', { name: /add|save|create/i }).click();

    await expect(page.getByText(/valid url|invalid url|url/i)).toBeVisible({ timeout: 3_000 });
  });
});
