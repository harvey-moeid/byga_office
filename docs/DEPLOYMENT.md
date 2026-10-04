# Cloudflare resources and permissions

The account, both D1 IDs and chart schema were verified through the Cloudflare connector. All five application migrations have now been applied remotely to `trading_office_db` and recorded in its Wrangler-compatible migration ledger. `chart_db` was only queried with SELECT. The concrete production settings are tracked in `deployment/production.json`; local development still uses placeholders. No production Worker deployment has been confirmed yet.

## Resources

1. Retain the existing `chart_db`; determine table name, OHLCV columns, timeframe values and timestamp units. Only timestamp numeric seconds/milliseconds and candle open timestamps are currently supported. An ISO timestamp or close-time schema needs an explicit reader extension, not silent conversion.
2. Create a separate `trading_office_db` for each staging/production environment. Apply only `migrations/` to this database. **Never migrate or seed remote `chart_db`.**
3. Deploy Worker and SQLite-backed `Office` Durable Object namespace. Live and simulation instances are distinct.
4. Optionally bind R2 `OFFICE_ASSETS` for future versioned GLB/textures. Current procedural office uses no R2 files; serving/versioning uploaded assets is not yet implemented.

Use a Cloudflare API token scoped to the selected account with Worker script deployment, Durable Object configuration, D1 application database provisioning/migrations and optional R2 access as required by the operation. Do not grant unrelated zone/DNS/account administration rights. Existing chart access must remain read-only in application code. Cloudflare D1 Worker bindings do not provide a per-query SELECT-only switch: the reader and tests enforce it; do not claim a platform-enforced read-only binding merely from the config.

## Configuration (nonsecret)

Set `BYGA_ENV=staging` or `production`, `CLOUDFLARE_ACCOUNT_ID`, `BYGA_CHART_DB_ID`, `BYGA_OFFICE_DB_ID`, `BYGA_PUBLIC_ORIGIN` (exact HTTPS origin), `BYGA_CHART_SCHEMA` (JSON). Optional `BYGA_R2_BUCKET`. Use separate databases/Worker names for staging and production.

Observed schema mapping for the supplied chart_db (closed-flag handling and tick size still require review; see the verification report):

```json
{"table":"candles","market":"symbol","timeframe":"timeframe","timestamp":"open_time","open":"open","high":"high","low":"low","close":"close","volume":"volume","closed":"is_closed","timestampUnit":"milliseconds","timeframeValues":{"H1":"H1","M15":"M15","M5":"M5"}}
```

```sh
node scripts/configure.mjs
# Set BYGA_DEPLOY_CONFIG to the printed .wrangler/deploy-<environment>.json path.
node scripts/wrangler.mjs d1 migrations apply trading_office_db --remote --config "$BYGA_DEPLOY_CONFIG"
npm run deploy
```

## Production workflow

Worker name: `byga-office` (production); `byga-office-staging` for staging. The generator uses the base name from `wrangler.jsonc`, adding an environment suffix only for staging.
Target: `https://byga-office.harveymoeid.workers.dev`.
GitHub environment: `production`. Nonsecret defaults come from `deployment/production.json`; environment variables override them. Staging requires its own settings and a distinct application database.

Add these secrets to the GitHub `production` environment through Settings → Environments → production → Environment secrets:

- `CLOUDFLARE_API_TOKEN`: the deployment/D1 token scoped to this account.
- `ADMIN_PASSWORD`: at least 12 characters; the workflow derives the PBKDF2 hash and installs only `ADMIN_PASSWORD_HASH` in the Worker.
- `OPENAI_API_KEY`: the selected production provider.

Optional: `DISCORD_MEETING_WEBHOOK` and `DISCORD_SIGNAL_WEBHOOK`. Missing webhooks remain unverified; do not call configured-only status successful delivery. Existing runtime secrets of other provider types are preserved by Wrangler but are not copied from unrelated Workers.

Changing the tracked production target triggers the deployment workflow on main. Otherwise run Actions → Deploy approved environment → Run workflow → production. Missing credentials fail before checkout/build/migrations.

The workflow runs code and browser checks, validates actual SELECT-only market reads through the application's reader (260 candles per timeframe with OHLC/gap/freshness guards), and makes one bounded OpenAI structured-output probe with synthetic input. The probe does not publish a signal. It then applies only application migrations, deploys initially with cron disabled, installs runtime secrets, verifies frontend/assets/D1/Durable Object/Admin login/cookie flags/origin rejection/logout, and enables cron only after acceptance. A failed initial smoke test leaves cron disabled. The final smoke test must also pass.

No full live-case AI/fallback/simulation acceptance or real Discord delivery is implied by the bounded probe. Physical device/FPS QA and premium R2/GLB assets remain separate acceptance items.

## Secrets

Use Cloudflare Worker Secrets for `ADMIN_PASSWORD_HASH`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `HF_TOKEN`, `COHERE_API_KEY`, `NVIDIA_API_KEY`, `DISCORD_MEETING_WEBHOOK`, and `DISCORD_SIGNAL_WEBHOOK`. These are Worker runtime secrets, not frontend values or D1 rows. Configure only the providers you have access to; primary/fallback choices must refer to models available to your accounts.

`CLOUDFLARE_API_TOKEN` is for deployment tooling, not an AI Worker secret. Supply credentials securely through environment settings/Cloudflare; never via chat or tracked files. Cloud environment proxy-secret target names beginning `OPENAI_` are reserved, so `OPENAI_API_KEY` cannot be registered through that draft tool. The application still uses the PRD name inside Cloudflare Worker Secrets, where it is supported.

## Required verification before production acceptance

Verify real BTCUSDT H1/M15/M5 reads and freshness/gaps; real model discovery and inference; fallback and circuit behavior; Admin login/cookies/CSRF; public signal toggles/history; signal idempotency; Discord meeting/final delivery without duplicates; retention; simulation isolation; mobile portrait/landscape/FPS; WebGL fallback; and deployed smoke checks. Keep untested items unchecked.
