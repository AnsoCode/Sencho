/**
 * File explorer E2E tests.
 *
 * Two scenarios are covered:
 *
 * 1. Community flow (read-only): the license endpoint is intercepted so the
 *    frontend believes the instance is community tier. Only viewing files is
 *    allowed; the upgrade pill is visible in the left pane and the Save button
 *    is absent from the editor toolbar.
 *
 * 2. Skipper+ flow (full CRUD): the real license state (paid) is used.
 *    Upload, edit-and-save, delete, and download are exercised end-to-end.
 *
 * Fixture files (config/app.conf and assets/logo.png) are seeded once via the
 * paid API in a beforeAll hook, and the entire test stack is torn down in
 * afterAll. Each beforeEach navigates to the stack and opens the Files panel.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { loginAs, waitForStacksLoaded } from './helpers';

const TEST_STACK = 'e2e-files-test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dismiss any "requires a paid license" or upgrade gate overlays that may
 * appear when operating in community mode. These are informational overlays
 * rendered by CapabilityGate for features like Auto-Heal Policies.
 */
async function dismissUpgradeOverlays(page: Page): Promise<void> {
  const dismissBtn = page.getByRole('button', { name: /dismiss/i });
  if (await dismissBtn.isVisible().catch(() => false)) {
    await dismissBtn.click();
    await page.waitForTimeout(200);
  }
}

/**
 * Click the test stack in the sidebar, then click the "files" link in the
 * anatomy panel header to enter the Files tab. This works regardless of the
 * current license tier because the Files panel itself is always rendered
 * (isPaid only gates edit/upload/delete within the panel).
 */
async function openFilesTab(page: Page): Promise<void> {
  await waitForStacksLoaded(page);

  // Ensure the stack appears in the sidebar (reload if necessary after seeding)
  const stackInSidebar = page.getByText(TEST_STACK, { exact: true }).first();
  if (!await stackInSidebar.isVisible().catch(() => false)) {
    await page.reload();
    await loginAs(page);
    await waitForStacksLoaded(page);
  }

  // Click the stack in the sidebar
  await page.getByText(TEST_STACK, { exact: true }).first().click();

  // Give the anatomy panel a moment to settle and load stack data
  await page.waitForTimeout(500);

  // Dismiss any upgrade/capability-gate overlays that block navigation
  await dismissUpgradeOverlays(page);

  // The anatomy panel header has a plain <button> labelled "files"
  const filesBtn = page.locator('button').filter({ hasText: /^files$/i }).first();
  await expect(filesBtn).toBeVisible({ timeout: 8_000 });
  await filesBtn.click();

  // We are now inside the editor view with the Files tab active.
  // Wait for the file tree to load (root-level entries visible, not skeletons).
  await expect(
    page.locator('span.font-mono').first()
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Seed the test stack with fixture files using the paid API.
 * Called once in a beforeAll so the files are present for every test.
 */
async function seedTestStack(page: Page): Promise<void> {
  await page.evaluate(async (name: string) => {
    // Create the stack (ignore 409 if it already exists)
    const createRes = await fetch('/api/stacks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stackName: name }),
    });
    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(`Failed to create stack: ${createRes.status}`);
    }

    async function mkdir(dir: string): Promise<void> {
      await fetch(
        `/api/stacks/${encodeURIComponent(name)}/files/folder?path=${encodeURIComponent(dir)}`,
        { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
    }

    async function upload(dir: string, filename: string, blob: Blob): Promise<void> {
      const fd = new FormData();
      fd.append('file', blob, filename);
      const res = await fetch(
        `/api/stacks/${encodeURIComponent(name)}/files/upload?path=${encodeURIComponent(dir)}`,
        { method: 'POST', credentials: 'include', body: fd },
      );
      if (!res.ok) throw new Error(`Failed to upload ${dir}/${filename}: ${res.status}`);
    }

    // Seed both directories in parallel: each mkdir must finish before its upload.
    const pngB64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
    const pngData = atob(pngB64);
    const pngBytes = new Uint8Array(pngData.length);
    for (let i = 0; i < pngData.length; i++) pngBytes[i] = pngData.charCodeAt(i);

    await Promise.all([
      mkdir('config').then(() => upload('config', 'app.conf', new Blob(['key=value\n'], { type: 'text/plain' }))),
      mkdir('assets').then(() => upload('assets', 'logo.png', new Blob([pngBytes], { type: 'image/png' }))),
    ]);
  }, TEST_STACK);
}

/** Delete the test stack via the authenticated browser session. */
async function teardownTestStack(page: Page): Promise<void> {
  await page.evaluate(async (name: string) => {
    await fetch(`/api/stacks/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});
  }, TEST_STACK);
}

const COMMUNITY_LICENSE_BODY = JSON.stringify({
  tier: 'community',
  status: 'community',
  variant: null,
  customerName: null,
  productName: null,
  maskedKey: null,
  validUntil: null,
  trialDaysRemaining: null,
  instanceId: 'test-instance',
  portalUrl: null,
  isLifetime: false,
});

/** Stub the /api/license endpoint so the frontend treats the session as community tier. */
async function mockCommunityLicense(context: BrowserContext): Promise<void> {
  await context.route('/api/license', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: COMMUNITY_LICENSE_BODY });
  });
}

// ---------------------------------------------------------------------------
// Community flow (read-only)
// ---------------------------------------------------------------------------

test.describe('File explorer - community (read-only)', () => {
  // Increase timeout: each test seeds fixtures + navigates
  test.setTimeout(60_000);

  test.beforeEach(async ({ page, context }) => {
    // Login first (without the license stub) so we can seed fixture files via the paid API.
    await loginAs(page);
    await seedTestStack(page);

    // Now install the community-tier stub and reload so the frontend picks it up.
    await mockCommunityLicense(context);
    await page.reload();
    await loginAs(page);

    await openFilesTab(page);
  });

  test.afterEach(async ({ page, context }) => {
    // Remove the stub before teardown so the delete API goes through (paid required).
    await context.unroute('/api/license');
    await page.reload();
    await loginAs(page);
    await teardownTestStack(page);
  });

  test('upgrade pill is visible in the left pane', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /upgrade to unlock/i })
    ).toBeVisible({ timeout: 5_000 });
  });

  test('can expand config/ and click config/app.conf - Save button is absent', async ({ page }) => {
    // The config/ directory should be visible in the tree
    const configNode = page.locator('span.font-mono').filter({ hasText: /^config$/ }).first();
    await expect(configNode).toBeVisible({ timeout: 8_000 });

    // Click to expand the directory
    await configNode.click();

    // app.conf should now appear under config/
    const appConfNode = page.locator('span.font-mono').filter({ hasText: /^app\.conf$/ }).first();
    await expect(appConfNode).toBeVisible({ timeout: 8_000 });
    await appConfNode.click();

    // The editor header should show "Read-only" badge (isPaid is false)
    await expect(page.getByText('Read-only')).toBeVisible({ timeout: 10_000 });

    // The Save button must NOT be present in community mode
    await expect(page.getByRole('button', { name: /^save$/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Skipper+ flow (full CRUD)
// ---------------------------------------------------------------------------

test.describe('File explorer - skipper+ (full CRUD)', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await seedTestStack(page);
    await openFilesTab(page);
  });

  test.afterEach(async ({ page }) => {
    await teardownTestStack(page);
  });

  test('upload a text file and verify it appears in the tree', async ({ page }) => {
    // Guard: paid users see the upload dropzone, not the upgrade pill.
    await expect(
      page.locator('[role="button"]').filter({ hasText: /upload file/i }).first()
    ).toBeVisible({ timeout: 5_000 });

    // Set a file on the hidden input
    const input = page.locator('input[type="file"][aria-label="Upload file"]');
    await input.setInputFiles({
      name: 'e2e-upload-test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello e2e\n'),
    });

    // Success toast
    await expect(page.getByText(/uploaded/i).first()).toBeVisible({ timeout: 10_000 });

    // File appears in the tree at root level
    await expect(
      page.locator('span.font-mono').filter({ hasText: /^e2e-upload-test\.txt$/ }).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('edit config/app.conf and save - success toast appears', async ({ page }) => {
    // Expand config/ and open app.conf
    const configNode = page.locator('span.font-mono').filter({ hasText: /^config$/ }).first();
    await expect(configNode).toBeVisible({ timeout: 8_000 });
    await configNode.click();

    const appConfNode = page.locator('span.font-mono').filter({ hasText: /^app\.conf$/ }).first();
    await expect(appConfNode).toBeVisible({ timeout: 8_000 });
    await appConfNode.click();

    // Wait for Monaco to load
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Save button must be present and initially disabled (no changes yet)
    const saveBtn = page.getByRole('button', { name: /^save$/i });
    await expect(saveBtn).toBeVisible({ timeout: 8_000 });

    // Edit the file content via Monaco
    const editorTextarea = page.locator('.monaco-editor textarea').first();
    await editorTextarea.click({ force: true });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('key=value\ne2e-edited=true\n');

    // Save button should now be enabled
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    // Success toast
    await expect(page.getByText(/saved/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test('delete an uploaded file - it disappears from the tree', async ({ page }) => {
    // Upload a disposable file first
    const input = page.locator('input[type="file"][aria-label="Upload file"]');
    await input.setInputFiles({
      name: 'e2e-to-delete.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('delete me\n'),
    });
    await expect(page.getByText(/uploaded/i).first()).toBeVisible({ timeout: 10_000 });

    // Click the file to select it
    const fileNode = page.locator('span.font-mono').filter({ hasText: /^e2e-to-delete\.txt$/ }).first();
    await expect(fileNode).toBeVisible({ timeout: 8_000 });
    await fileNode.click();

    // The action bar Delete button has a stable data-testid for reliable targeting.
    const actionBarDeleteBtn = page.getByTestId('file-action-delete');
    await expect(actionBarDeleteBtn).toBeVisible({ timeout: 5_000 });
    await actionBarDeleteBtn.click();

    // DeleteFileConfirm opens a Radix <Dialog> (role="dialog").
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    // The confirm button says "Delete". It is always the last button in the footer
    // (after Cancel). Click it to confirm deletion.
    await dialog.getByRole('button', { name: /delete/i }).last().click();

    // Use the tree-specific class (text-sm) to avoid a strict-mode violation:
    // the FileViewer header renders the same filename in a different span until
    // handleDeleted() clears selectedPath.
    await expect(
      page.locator('span.font-mono.text-sm').filter({ hasText: /^e2e-to-delete\.txt$/ })
    ).not.toBeAttached({ timeout: 8_000 });
  });

  test('download assets/logo.png - response is 200 with attachment header', async ({ page, request }) => {
    // Replay the browser's session cookies in a raw request to the download endpoint.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const res = await request.get(
      `/api/stacks/${encodeURIComponent(TEST_STACK)}/files/download` +
        `?path=${encodeURIComponent('assets/logo.png')}`,
      { headers: { cookie: cookieHeader } },
    );

    expect(res.status()).toBe(200);
    const disposition = res.headers()['content-disposition'] ?? '';
    expect(disposition).toMatch(/attachment/i);
  });
});
