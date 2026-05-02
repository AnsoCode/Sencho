import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config for Sencho.
 *
 * Before running: ensure both dev servers are up:
 *   cd backend && npm run dev &
 *   cd frontend && npm run dev &
 *
 * Or use the webServer config below (which starts them automatically).
 */
export default defineConfig({
  testDir: './e2e',
  // Don't stop on first failure - show all results
  maxFailures: 0,
  // How long to wait for a single test
  timeout: 30_000,
  // How long to wait for an expect() assertion
  expect: { timeout: 5_000 },
  // Run tests serially - Sencho is a single-user app and tests share DB state
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],

  use: {
    baseURL: 'http://localhost:5173',
    // Persist auth state between tests in the same file
    storageState: undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // Default project: skips the manual screenshot capture spec so
      // `npx playwright test` does not regenerate docs images on every run.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/screenshots.spec.ts'],
    },
    {
      // Manual-only project for capturing docs/images/. Run explicitly:
      //   npx playwright test --project=screenshots
      name: 'screenshots',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/screenshots.spec.ts'],
    },
  ],
});
