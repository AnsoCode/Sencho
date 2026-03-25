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
      // Pre-existing patterns — warn rather than error until addressed
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      'no-empty': 'warn',
      // Terminal output processing intentionally uses control characters in regexes
      'no-control-regex': 'off',
      'no-console': 'off',
      // New in ESLint 10 recommended — existing patterns, suppress until addressed
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
)
