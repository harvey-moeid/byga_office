# Cloudflare resources and permissions

The published Worker `byga-office` uses the production settings tracked in `deployment/production.json`; local development uses placeholders. [Deployment 38840278995](https://github.com/harvey-moeid/byga_office/actions/runs/38840278995) successfully published revision `cff88b7` on 16 October 2026. SELECT-only verification on 17 October confirmed all ten application migrations (0001–0010) in `trading_office_db`; Cloudflare GET confirmed cron **`*/5 * * * *`**. See [Production acceptance](PRODUCTION_ACCEPTANCE.md) for the dated evidence, degraded provider health and remaining operational checks, and [Production operations](PRODUCTION_OPERATIONS.md) for recovery. No remote chart migration or seed is part of this procedure.

## Resources

1. Retain the existing `chart_db`; determine table name, OHLCV columns, timeframe values and timestamp units. Only timestamp numeric seconds/milliseconds and candle open timestamps are currently supported. An ISO timestamp or close-time schema needs an explicit reader extension, not silent conversion.
2. Create a separate `trading_office_db` for each staging/production environment. Apply only `migrations/` to this database. **Never migrate or seed remote `chart_db`.**
3. Deploy Worker and SQLite-backed `Office` Durable Object namespace. Live and simulation instances are distinct.
4. Optionally bind R2 `OFFICE_ASSETS` for future versioned GLB/textures. Current procedural office uses no R2 files; serving/versioning uploaded assets is not yet implemented.

Use a Cloudflare API token scoped to the selected account with Worker script deployment, Durable Object configuration, D1 application database provisioning/migrations and optional R2 access as required by the operation. Do not grant unrelated zone/DNS/account administration rights. Existing chart access must remain read-only in application code. Cloudflare D1 Worker bindings do not provide a per-query SELECT-only switch: the reader and tests enforce it; do not claim a platform-enforced read-only binding merely from the config.

## Configuration (nonsecret)

Set `BYGA_ENV=staging` or `production`, `CLOUDFLARE_ACCOUNT_ID`, `BYGA_CHART_DB_ID`, `BYGA_OFFICE_DB_ID`, `BYGA_PUBLIC_ORIGIN` (exact HTTPS origin), `BYGA_CHART_SCHEMA` (JSON). Optional `BYGA_R2_BUCKET`. Use separate databases/Worker names for staging and production.

Verified schema mapping for the supplied chart_db (exchange tick size still requires review):

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
Target: `https://karyawanai.muidsoft.com`. The production generator declares this Custom Domain in Wrangler and uses it as the exact `PUBLIC_ORIGIN` for Admin mutations and deployed smoke checks. If `BYGA_PUBLIC_ORIGIN` is overridden in GitHub, it must match `custom_domain` in `deployment/production.json`.
Current verified release: published on 16 October; cron **`*/5 * * * *`** was read back on 17 October, matching `wrangler.jsonc`. The workflow first publishes with cron disabled and restores the schedule **only after initial deployed smoke succeeds**. A failure after temporary publication can leave that revision live with cron disabled; there is no automatic code/database/secret rollback. Repair the failure and rerun the full workflow before restoring automated trading. Existing Durable Object work is separate from the cron trigger; see the recovery runbook.
GitHub environment: `production`. Nonsecret defaults come from `deployment/production.json`; environment variables override them. Staging requires its own settings and a distinct application database.

Add these secrets to the GitHub `production` environment through Settings → Environments → production → Environment secrets:

- `CLOUDFLARE_API_TOKEN`: the deployment/D1 token scoped to this account.
- `ADMIN_PASSWORD`: at least 12 characters; the workflow derives the PBKDF2 hash and installs only `ADMIN_PASSWORD_HASH` in the Worker.
- `OPENROUTER_API_KEY`: the selected primary provider.
- `GEMINI_API_KEY`: the selected fallback provider.

Default character models are `openai/gpt-4.1-mini` through OpenRouter and `gemini-3.5-flash-lite` through the Gemini API. No direct `OPENAI_API_KEY` is required for this selection. Provider/model choices remain editable per character in Admin. New installations use these defaults; saved character settings are not overwritten by deployment.

Optional: `DISCORD_MEETING_WEBHOOK` and `DISCORD_SIGNAL_WEBHOOK`. Missing webhooks remain unverified; do not call configured-only status successful delivery. Existing runtime secrets of other provider types are preserved by Wrangler but are not copied from unrelated Workers.

Changes to runtime/frontend source, contracts, dependencies, migrations, configuration, and deployment scripts on `main` trigger `deploy.yml` automatically. **Test-only changes** under `tests/**`, `browser-tests/**`, or test/lint config files run validation but do not redeploy production. Run Actions → Deploy approved environment → Run workflow → production to deploy manually. Required credentials are checked after code/browser validation and before live probes, migrations or publication. Nonsecret values may be omitted from GitHub environment variables when the tracked production defaults are correct.

The workflow first runs dependency security gates and code/browser checks, validates actual SELECT-only market reads through the application's reader (260 candles per timeframe with OHLC/gap checks), and makes bounded structured-output provider probes with synthetic input. Upstream freshness lag is reported as a preflight warning; runtime trading reads remain strict. It then applies only application migrations and deploys initially with cron disabled. Required runtime secrets are refreshed; optional provider/webhook secrets are refreshed only when supplied by GitHub, preserving omitted bindings. A names/types-only inventory follows. **Cron restoration requires successful initial smoke**. Final smoke rejects structural unavailability but may accept freshness-only market degradation and provider `DEGRADED`; these remain operational issues rather than evidence of full acceptance. Public health and market status use the active Trading Config `processingDelaySeconds`, matching the pipeline. Use the stricter read-only `npm run production:check` to assess runtime health separately.

Before generating deployment configuration or applying remote migrations, both CI and this deployment workflow run the UI browser suite and `npm run test:browser:integration`. The latter exercises the Vite proxy, real Worker authentication/cookies, Durable Objects and isolated D1: config/APPLY NOW, privacy, scan/logout, and operation reconciliation after a lost response, expired session and reauthentication. The test bridge suppresses AI alarms and rejects outbound provider/Discord calls. The deployment job has a 30-minute timeout to accommodate both browser suites.

No full live-case AI/failover/simulation acceptance or real Discord delivery is implied by the bounded probe. Physical device/FPS QA and premium R2/GLB assets remain separate acceptance items.

Deployed smoke verifies the saved provider/model routes through the authenticated Worker endpoint, using runtime credentials (including encrypted Admin overrides). Each active character must have successful structured synthetic inference on its primary or fallback route. Shared provider/model pairs are probed once per smoke run; fallback is tried only when primary is unavailable or unconfigured. Unused Workers AI is not called. Workers AI error `4006` is reported as `DAILY_QUOTA_EXHAUSTED`; a failed provider permits deployment only when every character still has a verified route. Authentication/CSRF/routing errors and invalid probe responses remain fatal. Reports contain sanitized status codes rather than upstream error text. These probes verify route availability, not an end-to-end trading failover. If any character has no working route, initial smoke fails and cron remains disabled; repair the routes and rerun deployment. Cron is never restored unconditionally.

## Secrets

Use Cloudflare Worker Secrets for `ADMIN_PASSWORD_HASH`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `HF_TOKEN`, `COHERE_API_KEY`, `NVIDIA_API_KEY`, `DISCORD_MEETING_WEBHOOK`, and `DISCORD_SIGNAL_WEBHOOK`. These runtime bindings remain server secrets. Admin can additionally save encrypted provider-key overrides in application D1; plaintext keys never become frontend configuration. Configure only the providers you have access to; primary/fallback choices must refer to models available to your accounts.

`0008_provider_credentials.sql` is included in the verified production ledger through migration 0010. Apply all outstanding application migrations before publishing to a new environment. The workflow initializes `PROVIDER_KEYS_ENCRYPTION_KEY` only when absent and preserves it thereafter. Local setup uses `npm run credentials:setup`; manual remote setup uses `node scripts/credentials-key.mjs --config "$BYGA_DEPLOY_CONFIG"` after the target Worker exists. Preserve the encryption root when restoring backups or redeploying. See [API key storage and recovery](PROVIDER_API_KEYS.md). Local tests do not establish another environment's migration or secret state.

`CLOUDFLARE_API_TOKEN` is for deployment tooling, not an AI Worker secret. Supply credentials securely through environment settings/Cloudflare; never via chat or tracked files. Cloud environment proxy-secret target names beginning `OPENAI_` are reserved, so `OPENAI_API_KEY` cannot be registered through that draft tool. The application still uses the PRD name inside Cloudflare Worker Secrets, where it is supported.

## Required verification before production acceptance

Verify real BTCUSDT H1/M15/M5 reads and freshness/gaps; real model discovery and inference; fallback and circuit behavior; Admin login/cookies/CSRF; public signal toggles/history; signal idempotency; Discord meeting/final delivery without duplicates; retention; simulation isolation; mobile portrait/landscape/FPS; WebGL fallback; and deployed smoke checks. Keep untested items unchecked.


## Frontend publication

Frontend and backend are deployed together through `deploy.yml`, with the same code/browser/market/provider acceptance checks and production concurrency group. There is no comparison against a fixed backend commit. Both API/Admin smoke checks and SHA-256 verification of built JS/CSS assets run after publication.

The previous `frontend.yml` entry remains available for manual dispatch and calls the same full deployment workflow. It has no automatic push trigger, so a commit changing frontend and backend starts one deployment pipeline. This manual entry requires the same production secrets as a full deployment.

Provider probes make bounded real AI requests with synthetic input; they do not publish trading signals. Changes to configuration remain subject to the Admin activation rules.
