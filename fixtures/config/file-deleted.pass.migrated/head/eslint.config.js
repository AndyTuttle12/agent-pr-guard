import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    rules: { eqeqeq: 'error', 'no-unused-vars': 'error' },
  },
];
