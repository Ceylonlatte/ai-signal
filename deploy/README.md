# AI Signal — VPS Deployment Runbook

Two long-running processes + a database, all on your VPS:

- **db** — Postgres 16 + pgvector
- **web** — Next.js dashboard + ingest API (port 3000)
- **worker** — pipeline loop (normalize → embed → score → cluster)

Collectors are **scheduled one-off scripts**: HN + RSS run on the VPS (cron); Twitter + Reddit run on your **Mac** (launchd → POST to the VPS ingest API).

---

## 1. VPS prerequisites

```bash
# Docker Engine + Compose v2 (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh
docker compose version   # must be v2.x
git --version
```

Clone the repo:

```bash
sudo mkdir -p /opt && cd /opt
git clone https://github.com/Ceylonlatte/ai-signal.git
cd ai-signal
```

## 2. Secrets — create `/opt/ai-signal/.env` (NEVER commit; it's gitignored)

```bash
cat > .env <<'EOF'
DATABASE_URL=postgres://aisignal:aisignal@db:5432/aisignal
INGEST_TOKEN=<LONG_RANDOM_TOKEN>
BASIC_AUTH_USER=<your-user>
BASIC_AUTH_PASS=<STRONG_PASSWORD>
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

- Generate tokens: `openssl rand -hex 32`.
- `DATABASE_URL` here uses host `db` (the compose service); compose also injects it explicitly, so this line is just a default.
- **Rotate** the dev defaults (`admin/admin`, `dev-token`) — they must not reach production.

## 3. Docker image-pull proxy (ONLY if your daemon can't reach Docker Hub directly)

A normal VPS has direct egress and needs nothing here. If image pulls hang at 0 bytes (as on a proxied dev box), point the Docker daemon at your proxy:

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

## 4. First deploy

```bash
cd /opt/ai-signal
docker compose build                     # builds web + worker image (Dockerfile)
docker compose up -d db                   # start Postgres, wait for healthy
until docker compose exec -T db pg_isready -U aisignal; do sleep 1; done
docker compose exec -T db psql -U aisignal -d aisignal -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Run DB migrations once (one-off container using the built image + .env):
docker compose run --rm web npm run db:migrate

docker compose up -d web worker           # start app + pipeline
docker compose ps
```

### Verify

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000           # -> 401
curl -s -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" http://localhost:3000 | head
```

Put the dashboard behind HTTPS (Caddy/Traefik/nginx + Let's Encrypt) or restrict it to Tailscale — Basic Auth alone is plaintext.

## 5. Scheduled collectors (VPS cron)

Edit the host crontab (`crontab -e`) to call the scripts inside the running `worker` container (it has the code + `.env`):

```cron
0 */4 * * * cd /opt/ai-signal && docker compose exec -T worker npm run collect:hn  >> /var/log/aisignal-hn.log 2>&1
0 0 * * *   cd /opt/ai-signal && docker compose exec -T worker npm run collect:rss >> /var/log/aisignal-rss.log 2>&1
0 4 * * *   cd /opt/ai-signal && docker compose exec -T worker npm run cleanup      >> /var/log/aisignal-cleanup.log 2>&1
```

### Re-processing after a rubric change

Run migrations **before** the reset, and start the worker **after** it:

```bash
# 1. migrate (idempotent; also backfills raw_items.processed_at on existing rows
#    so history is NOT silently re-triaged through the LLM if you skip step 2)
docker compose run --rm web npm run db:migrate
# 2. wipe corpus + raw ledger (DESTRUCTIVE — also clears all 👍/👎 feedback).
#    Guarded: refuses to run without explicit confirmation.
docker compose exec -T -e RESET_CONFIRM=yes worker npm run reset-corpus
# 3. (re)start the worker so collectors re-pull and re-triage under the new rules
docker compose up -d worker
```

`reset-corpus` aborts unless `RESET_CONFIRM=yes` is set, and prints the target database name before truncating.

### Switching the embedding model (full restart)

A new embedding model lives in a different vector space, so every stored vector
must be regenerated. After deploying the new code (which sets the model + dim):

```bash
# 1. point .env at the new model, then recreate web+worker so they pick it up
sed -i 's#^EMBEDDING_MODEL=.*#EMBEDDING_MODEL=qwen/qwen3-embedding-8b#' .env
grep -q '^EMBEDDING_DIM=' .env || echo 'EMBEDDING_DIM=2048' >> .env
docker compose up -d web worker

# 2. wipe the corpus (items / embeddings / topics / scores / feedback / raw_items)
docker compose exec -T -e RESET_CONFIRM=yes worker npm run reset-corpus

# 3. drop stale keyword vectors so the worker re-embeds them with the new model
docker compose exec -T db psql -U aisignal -d aisignal -c "UPDATE keywords SET embedding = NULL;"

# 4. restart the worker so collectors re-pull and re-embed everything fresh
docker compose up -d worker
```

## 6. Twitter + Reddit ingestion — pushed by the digest skills (on your Mac)

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

## 7. CI/CD (GitHub Actions → GHCR → VPS pull & restart)

Add `.github/workflows/deploy.yml` (build + push image, then SSH to the VPS to pull & restart):

```yaml
name: deploy
on: { push: { branches: [main] } }
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - uses: docker/build-push-action@v6
        with: { context: ., push: true, tags: ghcr.io/ceylonlatte/ai-signal:latest }
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/ai-signal
            docker compose pull web worker || true
            docker compose run --rm web npm run db:migrate
            docker compose up -d
```

`docker-compose.yml` already declares both `build: .` and `image: ghcr.io/ceylonlatte/ai-signal:latest` on `web`+`worker`, so the same compose file works two ways: local `docker compose build` tags the built image, and the VPS `docker compose pull` fetches the CI-built one. The VPS must be able to read the image:

```bash
# On the VPS, log in to GHCR once (PAT with read:packages), OR make the package public:
echo "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
```

The workflow's deploy step is gated on `secrets.VPS_HOST` — until you add the VPS secrets, pushes still build + publish the image to GHCR but skip the SSH deploy. Store `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` as GitHub Actions secrets. **Never** put VPS credentials in the repo; use an SSH key, not a password. Simpler alternative to SSH-deploy: run [watchtower](https://containrrr.dev/watchtower/) on the VPS to auto-pull new images.

The `.github/workflows/deploy.yml` file is committed in this repo.

## 8. Operations

```bash
docker compose logs -f worker        # watch the pipeline
docker compose logs -f web
docker compose exec -T db psql -U aisignal -d aisignal -c "SELECT count(*) FROM items;"
docker compose restart worker        # after config/env changes
docker compose down                  # stop (keeps the pgdata volume)
```

## Security checklist

- [ ] Strong `BASIC_AUTH_PASS` + random `INGEST_TOKEN` in `.env` (not the dev defaults).
- [ ] `.env` is `chmod 600`, never committed (it's gitignored).
- [ ] Dashboard behind HTTPS or Tailscale (Basic Auth is plaintext on the wire).
- [ ] VPS access via SSH key only; rotate any password that ever appeared in chat/logs.
- [ ] OpenRouter key lives only in the VPS `.env` (and your local `.env`), never in git.
