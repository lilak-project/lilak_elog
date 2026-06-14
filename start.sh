#!/usr/bin/env bash
# Standard-name wrapper for elog.sh — kept so that automation following
# NEW_SERVICE_RULES.md (start.sh / stop.sh / status.sh) works for this project.
# Forwards every flag and environment variable.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/elog.sh" "$@"
