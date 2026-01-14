```Proyecto SaaS Centinela Cloud/backend/eslint.config.js#L1-200
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint config (flat) for Centinela backend (Node.js + TypeScript + ESM)
 *
 * Notes:
 * - Uses typescript-eslint recommended rules (type-aware rules can be enabled later).
 * - Keeps rules pragmatic for an early-stage MVP.
 * - Prettier is enforced by running Prettier separately (see package.json scripts).
 */
export default [
  // Ignore generated output
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended (non-type-aware)
  ...tseslint.configs.recommended,

  // Project rules
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // MVP pragmatism
      'no-console': 'off',

      // Prefer explicitness in TS, but don't over-restrict yet
      '@typescript-eslint/no-explicit-any': 'off',

      // Let TS handle unused vars; this rule is better than base no-unused-vars
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Reduce noise
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
];
