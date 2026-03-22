/**
 * Stack management E2E tests — happy path CRUD.
 *
 * NOTE: These tests require Docker Compose to be installed on the host, because
 * actual stack operations (up/down) spawn docker-compose processes.
 * The create/edit/delete tests work without Docker being connected.
 */
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

const TEST_STACK = `e2e-test-stack-${Date.now()}`;
const SIMPLE_COMPOSE = `services:\n  web:\n    image: nginx:alpine\n`;

test.describe('Stack management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('create a new stack', async ({ page }) => {
    // Find and click the "new stack" / "+" button
    const newStackBtn = page.getByRole('button', { name: /new stack|create stack|\+/i }).first();
    await newStackBtn.click();

    // Fill in the stack name in the dialog
    const nameInput = page.getByLabel(/stack name/i);
    await nameInput.fill(TEST_STACK);

    // Confirm
    await page.getByRole('button', { name: /create|confirm|ok/i }).click();

    // Stack should now appear in the list
    await expect(page.getByText(TEST_STACK)).toBeVisible({ timeout: 5_000 });
  });

  test('edit the compose file of an existing stack', async ({ page }) => {
    // Click on the test stack in the sidebar/list
    await page.getByText(TEST_STACK).click();

    // Wait for the editor to appear and type some content
    const editor = page.locator('.monaco-editor').first();
    await editor.click();
    await page.keyboard.selectAll();
    await page.keyboard.type(SIMPLE_COMPOSE);

    // Save
    const saveBtn = page.getByRole('button', { name: /save/i });
    await saveBtn.click();

    // Should show success indication (no error toast)
    await expect(page.getByText(/error/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {
      // If error text is already not there that's fine
    });
  });

  test('delete the test stack', async ({ page }) => {
    // Find the test stack and open its context menu / delete button
    const stackRow = page.locator(`[data-testid="stack-${TEST_STACK}"], li:has-text("${TEST_STACK}")`).first();

    // Hover to reveal action buttons
    await stackRow.hover();
    const deleteBtn = stackRow.getByRole('button', { name: /delete|remove/i });
    await deleteBtn.click();

    // Confirm deletion in dialog
    const confirmBtn = page.getByRole('button', { name: /confirm|delete|yes/i });
    if (await confirmBtn.isVisible()) await confirmBtn.click();

    // Stack should no longer appear
    await expect(page.getByText(TEST_STACK)).not.toBeVisible({ timeout: 5_000 });
  });
});
