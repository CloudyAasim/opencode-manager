import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.env*', 'coverage', 'src/utils/logger.ts']),
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
      },
      parserOptions: {
        project: true,
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-useless-escape': 'warn',
    },
  },
  {
    // by name, not by directory. A test that lives beside the code it covers
    // - src/routes/repos.test.ts - is still a test, and under `test/**` it was
    // linted as production code, which is where 29 `any`s came from.
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])