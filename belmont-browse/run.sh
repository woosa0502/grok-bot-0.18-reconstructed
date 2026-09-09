#!/usr/bin/env bash
# belmont-browse local runner (never committed). Usage: ./run.sh --task "..." [--auto-approve] [--verbose]
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/home/hoon/.nvm/versions/node/v26.8.1/bin:$PATH"
exec node src/run.mjs "$@"
