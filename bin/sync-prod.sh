#!/usr/bin/env bash
# One-click: pull the production database into the local dev database.
#
# Reads prod over SSH with a read-only pg_dump, then restores it into the local
# pgvector container. This OVERWRITES local data (dump uses --clean --if-exists),
# which is the whole point of "sync prod data". Prod is never written to.
#
#   npm run sync-prod        # prompts before overwriting local
#   npm run sync-prod -- -y  # skip the prompt (CI / repeat use)
#
# Override any of these via env if the topology changes:
#   PROD_SSH=ai-hot-news-prod
#   PROD_DB_CONTAINER=ai-signal-db-1
#   LOCAL_DB_CONTAINER=ai-signal-db-1
#   DB_USER=aisignal  DB_NAME=aisignal
set -euo pipefail

PROD_SSH="${PROD_SSH:-ai-hot-news-prod}"
PROD_DB_CONTAINER="${PROD_DB_CONTAINER:-ai-signal-db-1}"
LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-ai-signal-db-1}"
DB_USER="${DB_USER:-aisignal}"
DB_NAME="${DB_NAME:-aisignal}"

ASSUME_YES="${SYNC_CONFIRM:-}"
[ "${1:-}" = "-y" ] && ASSUME_YES="yes"

note() { printf '\033[36m▸ %s\033[0m\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

count_local() {
  docker exec "$LOCAL_DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "select count(*) from items" 2>/dev/null || echo "?"
}

# --- preflight ----------------------------------------------------------------
docker exec "$LOCAL_DB_CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 \
  || die "local db container '$LOCAL_DB_CONTAINER' not reachable (is docker compose up?)"
ssh -o BatchMode=yes "$PROD_SSH" "docker exec $PROD_DB_CONTAINER pg_isready -U $DB_USER" >/dev/null 2>&1 \
  || die "prod db not reachable over ssh '$PROD_SSH'"

LOCAL_BEFORE="$(count_local)"
PROD_ITEMS="$(ssh "$PROD_SSH" "docker exec $PROD_DB_CONTAINER psql -U $DB_USER -d $DB_NAME -tAc 'select count(*) from items'" 2>/dev/null || echo "?")"
note "local items: $LOCAL_BEFORE  →  prod items: $PROD_ITEMS"

if [ "$ASSUME_YES" != "yes" ]; then
  printf '\033[33mThis OVERWRITES the local db with prod. Continue? [y/N] \033[0m'
  read -r reply
  case "$reply" in [yY]*) ;; *) die "aborted" ;; esac
fi

# --- dump (prod, read-only) ---------------------------------------------------
DUMP="$(mktemp -t ai-signal-prod.XXXXXX.sql)"
trap 'rm -f "$DUMP"' EXIT
note "dumping prod ..."
ssh "$PROD_SSH" "docker exec $PROD_DB_CONTAINER pg_dump -U $DB_USER -d $DB_NAME --clean --if-exists --no-owner --no-acl" > "$DUMP"
BYTES="$(wc -c < "$DUMP" | tr -d ' ')"
[ "$BYTES" -gt 1000 ] || die "dump looks empty ($BYTES bytes)"
note "dump ok (${BYTES} bytes)"

# --- restore (local) ----------------------------------------------------------
note "restoring into local ..."
RESTORE_LOG="$(mktemp -t ai-signal-restore.XXXXXX.log)"
trap 'rm -f "$DUMP" "$RESTORE_LOG"' EXIT
docker exec -i "$LOCAL_DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=0 < "$DUMP" > "$RESTORE_LOG" 2>&1

# Benign DROP-on-empty noise ("... does not exist, skipping") is expected; flag
# anything else.
REAL_ERRORS="$(grep -iE '^(ERROR|FATAL)' "$RESTORE_LOG" | grep -viE 'does not exist|already exists' || true)"
if [ -n "$REAL_ERRORS" ]; then
  printf '\033[31m✗ restore reported errors:\033[0m\n%s\n' "$REAL_ERRORS" >&2
  exit 1
fi

LOCAL_AFTER="$(count_local)"
note "done. local items: $LOCAL_BEFORE → $LOCAL_AFTER (prod: $PROD_ITEMS)"
[ "$LOCAL_AFTER" = "$PROD_ITEMS" ] || printf '\033[33m! local/prod item counts differ — check above\033[0m\n'
