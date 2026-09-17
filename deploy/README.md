# AI Signal — VPS Deployment Runbook

Two long-running processes + a database, all on your VPS:

- **db** — Postgres 16 + pgvector
- **web** — Next.js dashboard + ingest API (port 3000)
- **worker** — pipeline loop (normalize → embed → score → cluster)

Collectors are **scheduled one-off scripts**: HN + RSS run on the VPS (cron); Twitter + Reddit run on your **Mac** (launchd → POST to the VPS ingest API).

---

## 0. How deploys actually work (read this first)

**Deployment is fully automated. `git push origin main` is the deploy.**
`.github/workflows/deploy.yml` builds the image on a GitHub runner, ships it to
the VPS as a tarball over scp, and restarts the stack over ssh. There is nothing
to run by hand, and nothing to pull on the VPS.

Two consequences that trip people up:

- **The VPS is not a git checkout.** `/opt/ai-signal` has **no `.git` directory**.
  `git pull` there fails with `fatal: not a git repository`. The `src/`,
  `bin/`, `package.json`, `node_modules/` etc. sitting in that directory are dead
  leftovers from the June 2026 bootstrap (frozen at 2026-06-03) and are **not what
  runs** — the code that runs lives inside the container image. Only
  **`docker-compose.yml`** (overwritten by CI on every deploy) and **`.env`**
  (hand-maintained, never touched by CI) are live.
- **The VPS never builds, and never pulls the app image.** The 1 GB VPS cannot
  build the Next.js image. The tag `ghcr.io/ceylonlatte/ai-signal:latest` is just
  a local name — the image arrives via `docker save` → scp → `docker load`, it is
  **never pushed to or pulled from GHCR**, and no registry credentials exist on
  the VPS. `docker compose build` and `docker compose pull web worker` on the VPS
  will both fail; don't run them.

Only the `db` image (`pgvector/pgvector:pg16`) is pulled normally from Docker Hub.

---

## 1. VPS prerequisites (one-time)

```bash
# Docker Engine + Compose v2 (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh
docker compose version   # must be v2.x
```

That's the whole dependency list — **no git, no Node, no build toolchain** on the
VPS. Then create the deploy directory, owned by the user CI ssh's in as:

```bash
sudo mkdir -p /opt/ai-signal
sudo chown "$USER":"$USER" /opt/ai-signal
```

CI writes `docker-compose.yml` into this directory on every deploy, so you do not
need to place it yourself. You only supply `.env` (next section).

> **Historical note, do not follow:** this directory was originally created with
> `git clone https://github.com/Ceylonlatte/ai-signal.git`, which is why a stale
> source tree is still lying around in it. That bootstrap path is obsolete and the
> `.git` directory is gone. Never `git pull`/`git clone` here, and never edit the
> source files in `/opt/ai-signal` expecting a change — the next deploy ignores
> them completely.

### GitHub Actions secrets (required — no secrets = no deploy)

Set these three on the repo (**Settings → Secrets and variables → Actions**):

| Secret | Value |
| --- | --- |
| `VPS_HOST` | VPS hostname or IP |
| `VPS_USER` | ssh user CI logs in as (currently `deploy`) |
| `VPS_SSH_KEY` | that user's **private** ssh key (PEM contents) |

Both the scp step and the ssh step are gated on `VPS_HOST` being non-empty. With
the secrets missing, a push still runs the workflow and still builds the image —
it just throws it away and deploys nothing, reporting green. **A green run does
not by itself prove a deploy happened**; if in doubt, check the run's step list
for "Copy image + compose to VPS".

**Never** put VPS credentials in the repo; use an ssh key, not a password.

## 2. Secrets — create `/opt/ai-signal/.env` (NEVER commit; it's gitignored)

This file lives **only on the VPS**. CI never reads, writes or overwrites it, so
adding a new env var means editing it here by hand and recreating the containers.

```bash
cd /opt/ai-signal
cat > .env <<'EOF'
DATABASE_URL=postgres://aisignal:aisignal@db:5432/aisignal
INGEST_TOKEN=<LONG_RANDOM_TOKEN>
# Dashboard login = Google OAuth (NextAuth). See "Google 登录配置" below.
AUTH_SECRET=<openssl rand -base64 32>
AUTH_GOOGLE_ID=<google-oauth-client-id>
AUTH_GOOGLE_SECRET=<google-oauth-client-secret>
AUTH_ALLOWED_EMAILS=you@gmail.com
AUTH_TRUST_HOST=true
OPENROUTER_API_KEY=<your-openrouter-key>
SCORING_MODEL=deepseek/deepseek-v4-flash
EMBEDDING_MODEL=qwen/qwen3-embedding-8b
EMBEDDING_DIM=2048
WEIGHT_HEAT=0.2
WEIGHT_RELEVANCE=0.2
WEIGHT_NOVELTY=0.15
WEIGHT_LLM=0.45
EOF
chmod 600 .env
```

- Generate tokens: `openssl rand -hex 32`; generate `AUTH_SECRET` with `openssl rand -base64 32`.
- `DATABASE_URL` here uses host `db` (the compose service); compose also injects it explicitly, so this line is just a default.
- **Rotate** the dev default `INGEST_TOKEN` (`dev-token`) — it must not reach production.
- `.env` must be readable by the ssh/cron user (it is `deploy:deploy 600` in production), because `docker compose` reads it on every CI deploy.

### Google 登录配置（NextAuth）

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID**，应用类型选 **Web application**。
2. **Authorized redirect URI** 填 `https://<你的域名>/api/auth/callback/google`（本地调试再加 `http://localhost:3000/api/auth/callback/google`）。
3. 把生成的 Client ID / Secret 填进 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`。
4. `AUTH_ALLOWED_EMAILS` 填允许登录的 Google 邮箱（逗号分隔）。**留空 = 任何人都登录不了**（安全默认）。
5. 未登录访问任意页面会被重定向到 `/login`（不再弹浏览器原生账号密码框）。

## 3. Docker image-pull proxy (ONLY if your daemon can't reach Docker Hub directly)

A normal VPS has direct egress and needs nothing here. This affects the `db`
image only — the app image never comes from a registry. If image pulls hang at 0
bytes (as on a proxied dev box), point the Docker daemon at your proxy:

```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/proxy.conf <<'EOF'
[Service]
Environment="HTTP_PROXY=http://PROXY_HOST:PORT"
Environment="HTTPS_PROXY=http://PROXY_HOST:PORT"
Environment="NO_PROXY=localhost,127.0.0.1"
EOF
sudo systemctl daemon-reload && sudo systemctl restart docker
```

## 4. Routine deploy — push to main

```bash
git push origin main
```

That's it. Migrations, image delivery and container restarts are all part of the
workflow. **Do not ssh in to "finish" the deploy.** You can also trigger a deploy
without a code change (`workflow_dispatch` is enabled):

```bash
gh workflow run deploy.yml
```

Concurrency is `deploy-<ref>` with `cancel-in-progress: true`, so pushing twice in
quick succession cancels the older run — the newest commit wins.

### Watch it

A deploy takes **~6 minutes** end to end (most of it the image build + transfer).

```bash
gh run list --workflow deploy.yml --limit 5          # recent deploys + their IDs
gh run watch <run-id>                                 # live tail until it finishes
gh run view <run-id> --log-failed                     # only the failing step's log
```

Tail the run you just triggered without copying an ID by hand:

```bash
gh run watch "$(gh run list --workflow deploy.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

### Verify the deploy landed

```bash
ssh ai-hot-news-prod 'cd /opt/ai-signal && docker compose ps'

# Unauthenticated request gets bounced to the login page (307 → /login):
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://<your-domain>/   # -> 307 .../login?callbackUrl=...
curl -s -o /dev/null -w "%{http_code}\n" https://<your-domain>/login              # -> 200
```

Put the dashboard behind HTTPS (Caddy/Traefik/nginx + Let's Encrypt). Google OAuth requires the public HTTPS callback URL configured in step 2 above to match exactly.

## 5. What CI actually runs (`.github/workflows/deploy.yml`)

Do **not** edit this by hand on the VPS; it is the source of truth for the deploy.
On the runner:

1. `actions/checkout@v5`
2. `docker build --platform linux/amd64 -t ghcr.io/ceylonlatte/ai-signal:latest .`
3. `docker save … | gzip > image.tar.gz`
4. `appleboy/scp-action` → copies `image.tar.gz` + `docker-compose.yml` to `/opt/ai-signal` (`overwrite: true`)

Then `appleboy/ssh-action` (20 min timeout) runs this on the VPS:

```bash
set -e
cd /opt/ai-signal
gunzip -f image.tar.gz
docker load -i image.tar
rm -f image.tar
docker compose up -d db
until docker compose exec -T db pg_isready -U aisignal; do sleep 2; done
docker compose exec -T db psql -U aisignal -d aisignal -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker compose run --rm web npm run db:migrate
docker compose up -d web worker
docker image prune -f
```

So **migrations run automatically on every deploy** — you never run `db:migrate`
by hand for a normal release. Steps 4 and 5 are skipped when `VPS_HOST` is empty.

### Bootstrapping a brand-new VPS

There is no separate "first deploy" procedure. Do sections 1 + 2 (docker,
`/opt/ai-signal`, `.env`, the three secrets), then push to main (or
`gh workflow run deploy.yml`). The same workflow creates the db volume, installs
pgvector, runs every migration and starts all three services from scratch.

## 6. Scheduled collectors (VPS cron)

Edit the host crontab (`crontab -e`) to call the scripts inside the running `worker`
container (it has the code + the env baked in by compose). Use `docker exec` against
the container name rather than `docker compose exec`: it needs neither the compose
file nor `.env`, so it keeps working regardless of file ownership or which
directory cron happens to run in.

```cron
PATH=/usr/local/bin:/usr/bin:/bin
0 */4 * * * docker exec ai-signal-worker-1 npm run collect:hn  >> /home/deploy/aisignal-logs/hn.log 2>&1
0 0 * * *   docker exec ai-signal-worker-1 npm run collect:rss >> /home/deploy/aisignal-logs/rss.log 2>&1
0 4 * * *   docker exec ai-signal-worker-1 npm run cleanup     >> /home/deploy/aisignal-logs/cleanup.log 2>&1
```

Container names are stable across deploys (compose recreates `ai-signal-worker-1`
under the same name), so the crontab survives releases untouched.

### What the nightly cleanup touches

`npm run cleanup` enforces the 30-day window (see `src/lib/cleanup.ts`). Deleted:
expired non-favorited `items` and their score/embedding/topic/KB rows plus the R2
images, expired `rss_items`, child rows whose item is gone, and topics that have no
members left and haven't been seen in 30 days. **Favorites are never deleted.**

Two tables are deliberately handled differently:

- **`raw_items` rows are kept forever.** They are the ingest dedupe ledger, and
  `/raw` + keyword search render straight out of `payload`. Only the untouched
  upstream API document at `payload->'raw'` is stripped once a row is past
  retention — about half the bytes, none of what the UI reads.
- **`model_usage` is never swept**, because `/status` sums it for all-time spend and
  the whole table is only ~8 MB.

## 7. Manual runbooks (the only things you still do by hand)

Everything below runs **on the VPS**, from the deploy directory:

```bash
ssh ai-hot-news-prod
cd /opt/ai-signal
```

`docker compose` works there because `docker-compose.yml` + `.env` are present and
the image is already loaded locally — **not** because there is a checkout. Never
add `git pull` or `docker compose build` to any of these.

### One-off: reclaim the bloat from the first slimming run

The payload strip is an `UPDATE`, so the first run (which slims the whole back
catalogue at once) leaves a dead tuple per row and `raw_items` temporarily grows.
The nightly job runs a plain `VACUUM`, which makes that space reusable and stops
the growth, but does not hand it back to the OS. To actually shrink the file, run
this once after the first nightly sweep — it takes an exclusive lock on the table
for a minute or two and needs free disk equal to the table size:

```bash
docker exec ai-signal-db-1 psql -U aisignal -d aisignal -c "VACUUM FULL raw_items, topics, item_embeddings"
```

### Re-processing after a rubric change

Push the rubric change and let CI deploy it first (it runs the migrations). Then,
on the VPS:

```bash
# 1. wipe corpus + raw ledger (DESTRUCTIVE — also clears all 👍/👎 feedback).
#    Guarded: refuses to run without explicit confirmation.
docker compose exec -T -e RESET_CONFIRM=yes worker npm run reset-corpus
# 2. restart the worker so collectors re-pull and re-triage under the new rules
docker compose up -d --force-recreate worker
```

`reset-corpus` aborts unless `RESET_CONFIRM=yes` is set, and prints the target database name before truncating.

Migrations are idempotent and already ran during the deploy; one of them backfills
`raw_items.processed_at` on existing rows so history is **not** silently re-triaged
through the LLM if you skip the reset. If you are resetting *without* having
deployed anything (e.g. an old container), run the migration yourself first:

```bash
docker compose run --rm web npm run db:migrate
```

### Switching the embedding model (full restart)

A new embedding model lives in a different vector space, so every stored vector
must be regenerated. Push the code change that sets the new model + dim, wait for
the deploy to go green, **then** on the VPS:

```bash
# 1. point .env at the new model (CI never touches .env), then recreate web+worker
sed -i 's#^EMBEDDING_MODEL=.*#EMBEDDING_MODEL=qwen/qwen3-embedding-8b#' .env
grep -q '^EMBEDDING_DIM=' .env || echo 'EMBEDDING_DIM=2048' >> .env
docker compose up -d --force-recreate web worker

# 2. wipe the corpus (items / embeddings / topics / scores / feedback / raw_items)
docker compose exec -T -e RESET_CONFIRM=yes worker npm run reset-corpus

# 3. drop stale keyword vectors so the worker re-embeds them with the new model
docker compose exec -T db psql -U aisignal -d aisignal -c "UPDATE keywords SET embedding = NULL;"

# 4. restart the worker so collectors re-pull and re-embed everything fresh
docker compose up -d --force-recreate worker
```

`--force-recreate` is what guarantees the containers pick up the edited `.env`;
a plain `up -d` may consider them up to date.

## 8. Twitter + Reddit ingestion — pushed by the digest skills (on your Mac)

The `opencli-twitter-digest` / `opencli-reddit-digest` skills push freshly
collected items to this app's `/api/ingest` on each run (opt-in, best-effort —
absent config = digests behave exactly as before).

On the Mac that produces the digests, create `~/.hermes/digest-ingest.env`
(chmod 600, never committed — it holds the token):

```bash
cat > ~/.hermes/digest-ingest.env <<'EOF'
export AI_SIGNAL_INGEST_URL="https://YOUR_VPS/api/ingest"
export AI_SIGNAL_INGEST_TOKEN="<same value as the app's INGEST_TOKEN>"
EOF
chmod 600 ~/.hermes/digest-ingest.env
```

The cron wrappers source this file before running, so each digest run also
ingests into the corpus. De-dup is handled by the `raw_items (source_id,
external_id)` constraint, so overlapping windows are safe. Requires the
logged-in x.com / reddit.com browser sessions the digests already depend on.

## 9. Operations

On the VPS, from `/opt/ai-signal`:

```bash
docker compose logs -f worker        # watch the pipeline
docker compose logs -f web
docker compose exec -T db psql -U aisignal -d aisignal -c "SELECT count(*) FROM items;"
docker compose restart worker        # after a container hiccup
docker compose down                  # stop (keeps the pgdata volume)
docker compose up -d                 # bring it back on the already-loaded image
```

To roll back, revert the commit and push — that is the only supported path, since
the VPS keeps just one app image tag and CI prunes the old ones (`docker image
prune -f`) at the end of every deploy.

To pull production data down to your Mac for debugging, use `npm run sync-prod`
(read-only `pg_dump` over ssh → restores into the local container).

## Security checklist

- [ ] Real `AUTH_SECRET` / `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, a non-empty `AUTH_ALLOWED_EMAILS`, and a random `INGEST_TOKEN` in `.env` (not the dev defaults).
- [ ] `.env` is `chmod 600`, never committed (it's gitignored), and owned by the ssh user CI deploys as.
- [ ] `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` live only in GitHub Actions secrets.
- [ ] Dashboard behind HTTPS or Tailscale (Basic Auth is plaintext on the wire).
- [ ] VPS access via SSH key only; rotate any password that ever appeared in chat/logs.
- [ ] OpenRouter key lives only in the VPS `.env` (and your local `.env`), never in git.
