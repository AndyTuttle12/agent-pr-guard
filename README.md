# agent-pr-guard

Warn-only check that flags AI coding agents weakening their own tests in pull requests

## Workflow

- `main` is protected: changes land only through pull requests, squash-merged with the
  PR title as the commit message (use a conventional-commit title), linear history.
- Required checks: `lint`, `typecheck`, `test` (see `.github/workflows/ci.yml`). They skip until `package.json` exists.
- Actions must be pinned to full commit SHAs; Dependabot keeps them current.

Licensed under the Apache License, Version 2.0 (see `LICENSE`).
