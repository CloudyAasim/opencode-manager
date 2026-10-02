import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src/sw.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: {
          defaultProject: "./tsconfig.app.json"
        },
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // A preset was turning this off, which let a duplicate onError in a
      // useMutation options object silently replace a rollback handler.
      // TypeScript says nothing about this; only this rule does.
      'no-dupe-keys': 'error',
      // This was a warning for a long time and was called a baseline. It is
      // not: it caught a useCallback that kept speaking the previous language
      // after the user switched, because t captures the language it was
      // created with. A rule that finds real bugs does not get to stay advice.
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}', 'src/features/message/FileToolRender.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Special rules for PromptInput
  {
    files: ['src/features/message/PromptInput.tsx'],
    rules: {
      'no-empty': 'off',
    }
  },
  // Special rules for test files
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      'vitest.config.ts',
      'playwright.config.ts',
      'e2e/**/*.ts',
    ],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        projectService: false
      },
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-empty': 'off',
    }
  },
])
