#!/usr/bin/env bash
set -euo pipefail
# was: make test
python -m pytest
mypy src
