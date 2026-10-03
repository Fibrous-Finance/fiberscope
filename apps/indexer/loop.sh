#!/bin/sh
# Runs `sync` with this script's arguments every REFRESH_MINUTES (whole minutes, default 10),
# counted from the start of each run. A failed run is logged and the next one runs on schedule.
# With SEED_DB_URL set and no database at DB_PATH yet, the database is first downloaded from that
# URL (`cli.ts seed`), which moves the indexer to a new host without indexing again.
# REFRESH_MINUTES, SEED_DB_URL and DB_PATH are read from this script's environment; ./.env is
# read only by each `sync`.
set -eu
cd "$(dirname "$0")"

# Stop at once when the host stops the container: SQLite and the snapshot writes are crash-safe.
child=
trap 'if [ -n "$child" ]; then kill "$child" 2>/dev/null; fi; exit 0' INT TERM

if [ -n "${SEED_DB_URL:-}" ] && [ ! -e "${DB_PATH:?DB_PATH must be set with SEED_DB_URL}" ]; then
	node src/cli.ts seed --url "$SEED_DB_URL"
fi

interval=$((${REFRESH_MINUTES:-10} * 60))
while :; do
	started=$(date +%s)
	# Each run reads ./.env when it exists. Node is only given the flag then: without the file,
	# --env-file-if-exists logs a notice on every run.
	if [ -f .env ]; then
		node --env-file=.env src/cli.ts sync "$@" &
	else
		node src/cli.ts sync "$@" &
	fi
	child=$!
	wait "$child" || echo "loop: sync exited with status $?" >&2
	remaining=$((interval - $(date +%s) + started))
	if [ "$remaining" -gt 0 ]; then
		sleep "$remaining" &
		child=$!
		wait "$child"
	fi
	child=
done
