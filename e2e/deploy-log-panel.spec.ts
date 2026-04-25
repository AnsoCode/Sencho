/**
 * Deploy log panel E2E tests.
 *
 * These tests require a running Docker daemon because they exercise real
 * docker compose up/down operations. Timeouts are generous to allow for
 * image pulls on a cold cache.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers';

const HAPPY_STACK = 'e2e-deploy-log-test';
const FAIL_STACK = 'e2e-deploy-log-fail-test';

const HAPPY_COMPOSE = `services:
  web:
    image: nginx:alpine
`;

const FAIL_COMPOSE = `services:
  web:
    image: nginnnnx:notexist
`;

async function waitForStacksLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Create Stack' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-stacks-loaded="true"]')).toBeAttached({ timeout: 15_000 });
}

async function createStackViaApi(page: Page, name: string, composeContent: string): Promise<void> {
  await page.evaluate(
    async ({ stackName, content }: { stackName: string; content: string }) => {
      const createRes = await fetch('/api/stacks', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: stackName }),
      });
      if (!createRes.ok && createRes.status !== 409) {
        throw new Error(`Failed to create stack: ${createRes.status}`);
      }

      const writeRes = await fetch(`/api/stacks/${stackName}/files/docker-compose.yml`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!writeRes.ok) {
        throw new Error(`Failed to write compose file: ${writeRes.status}`);
      }
    },
    { stackName: name, content: composeContent },
  );
}

async function deleteStackViaApi(page: Page, name: string): Promise<void> {
  await page.evaluate(async (stackName: string) => {
    await fetch(`/api/stacks/${stackName}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});
  }, name);
}

/**
 * Delete any leftover, create the stack, reload so the sidebar picks it up,
 * then click it to open the editor. Returns with the stack selected and the
 * Deploy button ready to click.
 */
async function setupDeployStack(page: Page, name: string, composeContent: string): Promise<void> {
  await deleteStackViaApi(page, name);
  await page.waitForTimeout(300);
  await createStackViaApi(page, name, composeContent);
  await page.reload();
  // loginAs is a no-op when already on the dashboard
  await loginAs(page);
  await waitForStacksLoaded(page);
  await page.getByText(name, { exact: true }).first().click();
}

test.describe('Deploy log panel', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await waitForStacksLoaded(page);
  });

  test('panel opens, streams output, and auto-closes on success', async ({ page }) => {
    test.setTimeout(90_000);

    await setupDeployStack(page, HAPPY_STACK, HAPPY_COMPOSE);

    await page.getByRole('button', { name: /Deploy|Start/i }).first().click();

    const panel = page.locator('[data-testid="deploy-log-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Verify an initial status indicator appears before waiting for completion
    const connectingText = page.getByText(/Connecting\.\.\./i);
    const succeededText = page.getByText(/Deployed|Stopped|Restarted|Updated/i);
    await Promise.race([
      connectingText.waitFor({ state: 'visible', timeout: 10_000 }),
      succeededText.waitFor({ state: 'visible', timeout: 10_000 }),
    ]);

    await expect(page.getByText(/successfully/i)).toBeVisible({ timeout: 60_000 });

    // Panel auto-closes AUTO_CLOSE_DELAY_MS (4s) after success; allow up to 12s total
    await expect(panel).toBeHidden({ timeout: 12_000 });
  });

  test('panel stays open with error indicator on failure', async ({ page }) => {
    test.setTimeout(90_000);

    await setupDeployStack(page, FAIL_STACK, FAIL_COMPOSE);

    await page.getByRole('button', { name: /Deploy|Start/i }).first().click();

    const panel = page.locator('[data-testid="deploy-log-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Docker fails to pull the nonexistent image; give it up to 60s to attempt and fail
    await expect(
      page.getByText(/failed|error|not found|unable to find/i).first(),
    ).toBeVisible({ timeout: 60_000 });

    // Panel must remain open on failure; assert it is still visible after 10s
    await page.waitForTimeout(10_000);
    await expect(panel).toBeVisible();
  });

  test('panel can be minimized and expanded while deploy is in progress', async ({ page }) => {
    test.setTimeout(90_000);

    await setupDeployStack(page, HAPPY_STACK, HAPPY_COMPOSE);

    await page.getByRole('button', { name: /Deploy|Start/i }).first().click();

    const panel = page.locator('[data-testid="deploy-log-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const terminalBody = page.locator('[data-testid="deploy-log-terminal-body"]');

    const minimizeBtn = page.getByRole('button', { name: 'Minimize panel' });
    await expect(minimizeBtn).toBeVisible({ timeout: 5_000 });
    await minimizeBtn.click();

    // Terminal body is hidden via display:none when minimized; SheetContent stays in the DOM
    await expect(terminalBody).toBeHidden({ timeout: 5_000 });
    await expect(panel).toBeVisible();

    const expandBtn = page.getByRole('button', { name: 'Expand panel' });
    await expect(expandBtn).toBeVisible({ timeout: 5_000 });
    await expandBtn.click();

    await expect(terminalBody).toBeVisible({ timeout: 5_000 });
  });

  test.afterEach(async ({ page }) => {
    await deleteStackViaApi(page, HAPPY_STACK);
    await deleteStackViaApi(page, FAIL_STACK);
  });
});
