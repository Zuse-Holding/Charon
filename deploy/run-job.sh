#!/usr/bin/env bash
# Run one Selene OS job with the repo's .env loaded, logging to logs/<job>.log.
# flock keeps a slow run from overlapping the next cron tick of the same job.
#
#   deploy/run-job.sh inbox|finance|enrichment|compliance|brief|executor|invoices
set -euo pipefail

job="${1:?usage: run-job.sh <job>}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

set -a
# shellcheck disable=SC1091
. "$repo/.env"
set +a

python="${SELENE_PYTHON:-$repo/.venv/bin/python}"
mkdir -p "$repo/logs"

if [ "$job" = "executor" ] || [ "$job" = "invoices" ]; then
  module=(-m "agents.$job")
else
  module=(-m agents.selene "$job")
fi

{
  echo "--- $(date -Is) $job"
  flock -n "/tmp/selene-$job.lock" "$python" "${module[@]}" || echo "exit $? (or still running from last tick)"
} >> "$repo/logs/$job.log" 2>&1
