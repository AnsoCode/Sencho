import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022 },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow unused catch-clause vars (catch (error) { ... }) and _-prefixed intentional ignores
      '@typescript-eslint/no-unused-vars': ['error', {
        caughtErrors: 'none',
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
      }],
      // Pre-existing patterns - warn rather than error until addressed
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      'no-empty': 'warn',
      // Terminal output processing intentionally uses control characters in regexes
      'no-control-regex': 'off',
      'no-console': 'off',
      // New in ESLint 10 recommended - existing patterns, suppress until addressed
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      // The private @studio-saelix/sencho-pro package is loaded at
      // runtime via dynamic import in entitlements/loadProvider.ts.
      // A static import would (a) bundle the package into the public
      // BSL build via TypeScript's module resolution, defeating the
      // privacy split, and (b) break in Community-only environments
      // where the package is not installed. Use loadEntitlementProvider()
      // and the registry instead.
      // no-restricted-imports flags ES `import` statements only by
      // default; dynamic `import()` expressions are not flagged unless
      // we set `allowDynamicImports: false`. The loader uses
      // `await import('@studio-saelix/sencho-pro')` and is therefore
      // not affected without an extra opt-in.
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@studio-saelix/sencho-pro', '@studio-saelix/sencho-pro/*'],
            message: 'Do not statically import the private package. Use loadEntitlementProvider() and getEntitlementProvider() from src/entitlements/.',
          },
        ],
      }],
    },
  },
)
