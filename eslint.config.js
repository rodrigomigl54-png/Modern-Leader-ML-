import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'dist-itch/', 'coverage/', 'node_modules/', 'tools/.cache/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js', 'tools/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The simulation core must stay pure: no rendering, no DOM, no UI (GDD section 2).
    files: ['src/sim/**'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', 'pixi.js/*', '@pixi/*'],
              message: 'src/sim must not import PixiJS.',
            },
            {
              group: ['**/map/**', '**/ui/**', '**/i18n/**'],
              message: 'src/sim must not import presentation code.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded random generator; the simulation must be deterministic.',
        },
      ],
    },
  },
  prettier,
);
