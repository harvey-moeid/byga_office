# Cloudflare resources and permissions

Account and distinct chart/application D1 IDs have been supplied and saved in the cloud configuration draft. Their formats are valid locally; remote ownership, existence and access remain unverified. The local copy is ignored at `.wrangler/cloud-resources.json`. The deployment environment, HTTPS origin, market schema and credentials are still required. The repository does not guess the schema of the existing `chart_db`.

## Resources

1. Retain the existing `chart_db`; determine table name, OHLCV columns, timeframe values and timestamp units. Only timestamp numeric seconds/milliseconds and candle open timestamps are currently supported. An ISO timestamp or close-time schema needs an explicit reader extension, not silent conversion.
2. Create a separate `trading_office_db` for each staging/production environment. Apply only `migrations/` to this database. **Never migrate or seed remote `chart_db`.**
3. Deploy Worker and SQLite-backed `Office` Durable Object namespace. Live and simulation instances are distinct.
4. Optionally bind R2 `OFFICE_ASSETS` for future versioned GLB/textures. Current procedural office uses no R2 files; serving/versioning uploaded assets is not yet implemented.

Use a Cloudflare API token scoped to the selected account with Worker script deployment, Durable Object configuration, D1 application database provisioning/migrations and optional R2 access as required by the operation. Do not grant unrelated zone/DNS/account administration rights. Existing chart access must remain read-only in application code. Cloudflare D1 Worker bindings do not provide a per-query SELECT-only switch: the reader and tests enforce it; do not claim a platform-enforced read-only binding merely from the config.

## Configuration (nonsecret)

Set `BYGA_ENV=staging` or `production`, `CLOUDFLARE_ACCOUNT_ID`, `BYGA_CHART_DB_ID`, `BYGA_OFFICE_DB_ID`, `BYGA_PUBLIC_ORIGIN` (exact HTTPS origin), `BYGA_CHART_SCHEMA` (JSON). Optional `BYGA_R2_BUCKET`. Use separate databases/Worker names for staging and production.

Example schema mapping (replace to match the real database):

```json
{"table":"candles","market":"symbol","timeframe":"timeframe","timestamp":"timestamp","open":"open","high":"high","low":"low","close":"close","volume":"volume","timestampUnit":"seconds","timeframeValues":{"H1":"1h","M15":"15m","M5":"5m"},"tickSize":0.01}
```

```sh
node scripts/configure.mjs
# Set BYGA_DEPLOY_CONFIG to the printed .wrangler/deploy-<environment>.json path.
node scripts/wrangler.mjs d1 migrations apply trading_office_db --remote --config "$BYGA_DEPLOY_CONFIG"
npm run deploy
```

A manual GitHub Actions deployment workflow is supplied. Configure GitHub environment variables/secrets and branch/environment protections before using it. The workflow is not tested against an actual account yet.

## Secrets

Use Cloudflare Worker Secrets for `ADMIN_PASSWORD_HASH`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `HF_TOKEN`, `COHERE_API_KEY`, `NVIDIA_API_KEY`, `DISCORD_MEETING_WEBHOOK`, and `DISCORD_SIGNAL_WEBHOOK`. These are Worker runtime secrets, not frontend values or D1 rows. Configure only the providers you have access to; primary/fallback choices must refer to models available to your accounts.

`CLOUDFLARE_API_TOKEN` is for deployment tooling, not an AI Worker secret. Supply credentials securely through environment settings/Cloudflare; never via chat or tracked files. Cloud environment proxy-secret target names beginning `OPENAI_` are reserved, so `OPENAI_API_KEY` cannot be registered through that draft tool. The application still uses the PRD name inside Cloudflare Worker Secrets, where it is supported.

## Required verification before production acceptance

Verify real BTCUSDT H1/M15/M5 reads and freshness/gaps; real model discovery and inference; fallback and circuit behavior; Admin login/cookies/CSRF; public signal toggles/history; signal idempotency; Discord meeting/final delivery without duplicates; retention; simulation isolation; mobile portrait/landscape/FPS; WebGL fallback; and deployed smoke checks. Keep untested items unchecked.
