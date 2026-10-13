import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'dist-electron/**', 'native/**', '.native-build-tools/**', '.local/**', 'release/**', 'release-v*/**', 'output/**', '.playwright-cli/**', 'mac-update-helper.cjs', 'services/smorec-service/smorec_service/static/vendor/**'] },
  { ignores: ['public/beauty/runtime/**', 'public/beauty/worker.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off',
    },
  },
);
