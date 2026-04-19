/**
 * Stack management E2E tests - happy path CRUD.
 */
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

const TEST_STACK = 'e2e-test-stack';

/** Wait for the stacks sidebar to finish loading (skeletons replaced with actual stack list). */
async function waitForStacksLoaded(page: import('@playwright/test').Page) {
  await expect(page.getByRole('button', { name: 'Create Stack' })).toBeVisible({ timeout: 15_000 });
  // The CommandList has data-stacks-loaded="true" once the async refreshStacks() completes.
  // Without this, tests can race against the loading state and miss newly created stacks.
  await expect(page.locator('[data-stacks-loaded="true"]')).toBeAttached({ timeout: 15_000 });
}

/** Delete the test stack via the browser's authenticated fetch (so cookies are included). */
async function deleteTestStackViaApi(page: import('@playwright/test').Page) {
  await page.evaluate(async (name) => {
    await fetch(`/api/stacks/${name}`, { method: 'DELETE', credentials: 'include' }).catch(() => { });
  }, TEST_STACK);
}

test.describe('Stack management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await waitForStacksLoaded(page);
  });

  test('create a new stack', async ({ page }) => {
    // Remove leftover from prior runs (using browser context auth)
    await deleteTestStackViaApi(page);
    await page.waitForTimeout(500);

    // Reload to get a fresh sidebar without the deleted stack
    await page.reload();
    await loginAs(page); // may re-login if cookie expired, otherwise skips to dashboard
    await waitForStacksLoaded(page);

    await page.getByRole('button', { name: 'Create Stack' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await page.locator('#create-stack-name').fill(TEST_STACK);
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Create' }).click();

    // Wait for dialog to close (success) or error message to appear (failure)
    await Promise.race([
      page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 8_000 }),
      page.getByText(/already exists/i).waitFor({ state: 'visible', timeout: 8_000 }),
    ]).catch(() => { });

    // The stack should now exist - refresh and verify via the sidebar
    await page.reload();
    await loginAs(page);
    await waitForStacksLoaded(page);

    await expect(page.getByText(TEST_STACK).first()).toBeVisible({ timeout: 5_000 });
  });

  test('delete the test stack', async ({ page }) => {
    // Confirm the stack exists in the sidebar
    await expect(page.getByText(TEST_STACK).first()).toBeVisible({ timeout: 5_000 });

    // Click on the stack to open the editor
    await page.getByText(TEST_STACK).first().click();

    // Destructive actions live under the overflow menu in the stack toolbar
    await page.getByRole('button', { name: 'More actions' }).click();
    const deleteItem = page.getByRole('menuitem', { name: /delete/i });
    await expect(deleteItem).toBeVisible({ timeout: 10_000 });
    await deleteItem.click();

    // AlertDialog confirmation
    await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();

    // Stack should no longer appear in the sidebar (exact match to avoid false positives from
    // similarly-named stacks; scoped to the CommandList)
    await expect(
      page.locator('[role="listbox"]').getByText(TEST_STACK, { exact: true })
    ).not.toBeVisible({ timeout: 8_000 });
  });
});
