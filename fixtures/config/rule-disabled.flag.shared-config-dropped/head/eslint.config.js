const sharedConfig = require('eslint-config-shared/flat');
const strictConfig = require('eslint-config-strict/flat');

module.exports = [
  ...sharedConfig,
  {
    ignores: ['dist/*'],
  },
];
