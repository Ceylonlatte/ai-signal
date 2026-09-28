#!/bin/bash
# SessionStart hook for Claude Code on the web: give the cloud container a
# local Postgres + pgvector test database and installed deps, so `pnpm test`
# and `pnpm typecheck` work. Local machines are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PG_VERSION=16
TEST_DB=aisignal_test
TEST_DATABASE_URL="postgres://aisignal:aisignal@localhost:5432/${TEST_DB}"

# pgvector: tests/setup/global-setup.ts runs `CREATE EXTENSION vector`.
if [ ! -f "/usr/share/postgresql/${PG_VERSION}/extension/vector.control" ]; then
  # Unrelated PPAs may be blocked by the network policy; that only warns.
  apt-get update -qq || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "postgresql-${PG_VERSION}-pgvector"
fi

if ! pg_isready -q -h localhost -p 5432; then
  pg_ctlcluster "${PG_VERSION}" main start
  until pg_isready -q -h localhost -p 5432; do sleep 1; done
fi

# Throwaway test role + database, matching the docker-compose credentials.
su postgres -c "psql -v ON_ERROR_STOP=1 -q" << 'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aisignal') THEN
    CREATE ROLE aisignal LOGIN SUPERUSER PASSWORD 'aisignal';
  END IF;
END $$;
SQL
if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'\"" | grep -q 1; then
  su postgres -c "createdb -O aisignal ${TEST_DB}"
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export TEST_DATABASE_URL=\"${TEST_DATABASE_URL}\"" >> "$CLAUDE_ENV_FILE"
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
pnpm install
