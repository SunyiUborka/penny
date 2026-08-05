import js from '@eslint/js';
import vuePlugin from 'eslint-plugin-vue';
import promisePlugin from 'eslint-plugin-promise';
import vueParser from 'vue-eslint-parser';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

const MONEY_RESTRICTED_SYNTAX = [
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message:
      'parseFloat tilos: pénzt egész számként (amountMinor) kezelünk, sosem lebegőpontosként.',
  },
  {
    selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
    message:
      'Number.parseFloat tilos: pénzt egész számként (amountMinor) kezelünk, sosem lebegőpontosként.',
  },
  {
    selector: "CallExpression[callee.property.name='toFixed']",
    message:
      '.toFixed( tilos pénzösszegen: használj Intl.NumberFormat-ot a kijelzett formázó modulban.',
  },
];

const baseRules = {
  eqeqeq: ['error', 'always'],
  'no-implicit-coercion': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  'no-unused-vars': ['error', { args: 'all', argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'consistent-return': 'error',
  'require-await': 'error',
  'promise/catch-or-return': 'error',
  'promise/always-return': 'error',
  'promise/no-return-wrap': 'error',
  'promise/param-names': 'error',
};

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'apps/web/dist/**', 'mongo-data/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    plugins: { promise: promisePlugin },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: baseRules,
  },
  {
    files: ['apps/web/**/*.js', 'apps/web/**/*.vue'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  ...vuePlugin.configs['flat/recommended'].map((config) => ({
    ...config,
    files: ['apps/web/**/*.vue'],
  })),
  {
    files: ['apps/web/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
      },
      globals: { ...globals.browser },
    },
    plugins: { promise: promisePlugin },
    rules: baseRules,
  },
  {
    // Pénzszabály: minden JS/Vue fájlra vonatkozik, a megjelölt formázó modul kivételével,
    // és inline eslint-disable kommenttel sem kerülhető meg.
    files: ['**/*.js', '**/*.vue'],
    ignores: ['packages/shared/src/currency/format.js'],
    linterOptions: {
      noInlineConfig: true,
    },
    rules: {
      'no-restricted-syntax': ['error', ...MONEY_RESTRICTED_SYNTAX],
    },
  },
  {
    files: ['packages/shared/src/currency/format.js'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  prettierConfig,
];
