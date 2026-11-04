const sharedConfig = require('eslint-config-shared/flat');

module.exports = [
  sharedConfig,
  {
    ignores: ['dist/*'],
  },
];
