import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Only run TypeScript sources - exclude the compiled dist/ output.
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    // Each test file gets its own worker so singletons are fresh between files.
    pool: 'forks',
    // Timeout generous for DB init and HTTP calls.
    testTimeout: 30_000,
    // Every test file dynamic-imports the full Express stack; each fork pays
    // TypeScript transformation cost and can take tens of seconds under
    // CPU contention when all 64 fork workers run at once.
    hookTimeout: 45_000,
    // Sequential within each file (DB state is shared per file).
    sequence: { concurrent: false },
  },
});
