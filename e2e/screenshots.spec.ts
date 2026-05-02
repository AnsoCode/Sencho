/**
 * Docs screenshot capture.
 *
 * Takes canonical screenshots of key UI views and writes them to docs/images/.
 * Run manually after a UI change that affects a documented view:
 *   npx playwright test --project=screenshots
 * Then review the diff under docs/images/ and commit on a chore branch.
 * The default `playwright test` invocation skips this spec via the
 * project-level testIgnore in playwright.config.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { test } from '@playwright/test';
import { loginAs } from './helpers';

const DOCS_IMAGES = path.resolve(__dirname, '../docs/images');

test.use({
  viewport: { width: 1280, height: 800 },
  // Always capture - this spec exists solely to produce screenshots
  screenshot: 'on',
});

test.beforeAll(() => {
  fs.mkdirSync(DOCS_IMAGES, { recursive: true });
});

test('login page', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(DOCS_IMAGES, 'login.png'), fullPage: true });
});

test('dashboard', async ({ page }) => {
  await loginAs(page);
  // Wait for stats widgets to settle
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: path.join(DOCS_IMAGES, 'dashboard.png'), fullPage: true });
});

test('stacks', async ({ page }) => {
  await loginAs(page);
  await page.getByRole('button', { name: 'Create Stack' }).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: path.join(DOCS_IMAGES, 'stacks.png'), fullPage: true });
});

test('resources', async ({ page }) => {
  await loginAs(page);
  await page.getByRole('button', { name: /resources/i }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(DOCS_IMAGES, 'resources.png'), fullPage: true });
});
