#!/usr/bin/env bash
set -euo pipefail

log() {
    echo "INFO: $1"
}

commands_for() {
    case "$1" in
        python) echo "cd src && pytest && ruff check ." ;;
        rust) echo "cargo test && cargo clippy" ;;
        node) printf '%s\n' "npm test && npm run lint" ;;
        *) echo "# Add commands for $1" ;;
    esac
}

write_guide() {
    cat <<'DOC' > "$1"
## Commands

Run `npm test` before pushing, and `npm run typecheck` for types.
DOC
    log "wrote $1"
}

write_guide AGENTS.md
commands_for "${LANG_NAME:-node}"
