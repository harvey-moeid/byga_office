# Production acceptance — 4 October 2026 (UTC)

## Current production state

Worker: `byga-office`  
URL: https://byga-office.harveymoeid.workers.dev  
Code: `aff739c0c93458a1fd9fa8a664aec384be9e944a`

The Worker is published and the deployed application/Admin smoke checks pass. **The one-minute cron is now configured**: at 07:31:02 UTC (14:31:02 WIB), the Cloudflare schedules API accepted `* * * * *`, and a subsequent GET returned that schedule. This resolves the configuration blocker. Repeated scheduled execution is not yet accepted. The earlier deployment job remains a historical failed run; it was not re-run to install this schedule.

## Confirmed

- [CI 37184871468](https://github.com/harvey-moeid/byga_office/actions/runs/37184871468): **109 unit/integration tests**, **30 browser tests**, TypeScript, ESLint, frontend build and Worker dry run passed.
- [Deployment 37184871525](https://github.com/harvey-moeid/byga_office/actions/runs/37184871525): credential preflight, code/browser checks, real market reads, both AI probes, app-only migrations, Worker publication, runtime secret installation and initial deployed smoke checks passed.
- Required GitHub production secrets are `CLOUDFLARE_API_TOKEN`, `ADMIN_PASSWORD`, `OPENROUTER_API_KEY` and `GEMINI_API_KEY`. The workflow derives/installs only `ADMIN_PASSWORD_HASH` for runtime Admin authentication. A direct OpenAI key is no longer required.
- Real SELECT-only application market reader at 07:11:12 UTC: 260 closed BTCUSDT candles per H1/M15/M5 passed OHLC/volume, gaps and freshness. These checks are snapshots; strict freshness protection remains active.
- Real model discovery and one bounded synthetic structured inference per provider passed through the actual adapter in the GitHub runner: OpenRouter `openai/gpt-4.1-mini` (251 tokens) and Gemini `gemini-3.5-flash-lite` (126 tokens). The probes publish no trading signals. Full Worker case processing and failover are separate acceptance items.
- Both selected runtime secret names were confirmed in Cloudflare settings, without reading/exposing values.
- All eight stored character configurations were verified with OpenRouter primary and Gemini fallback using the models above.
- Deployed frontend shell/static JavaScript, Durable Object state, production candle API, provider configuration, unauthorized Admin rejection, test-route absence, real Admin login, Secure/HttpOnly/SameSite=Strict cookie flags, wrong-origin rejection and logout/session invalidation passed.
- All five application migrations are applied to `trading_office_db`; 22 application tables and the migration ledger were verified. No migrations or seed writes were applied to remote `chart_db`.

## Scheduling configuration — blocker resolved

The earlier enable-cron step returned Cloudflare **10072**:

> This account has reached the Workers Free limit of 5 cron triggers per account.

On the subsequent user-requested check, PUT schedules returned HTTP 200/success and GET confirmed `* * * * *` for `byga-office`. No other Worker's trigger was deleted or modified, and no account plan was changed by this action. The schedule matches the tracked Wrangler configuration; no application code or runtime secret was changed.

At 07:34:17 UTC, the office state had changed to `market_error: Stale M5 data`, while `scanner_runs` still contained zero rows. No manual scan was issued in this check; this is evidence that the scheduled tick reached the market freshness guard, not a successful market scan. A SELECT-only chart snapshot showed latest closed opens H1 06:00 UTC, M15 07:00 UTC, and M5 07:20 UTC (closed at 07:25 UTC), explaining the stale M5 rejection. Freshness checks were not relaxed and no chart data was written. Repeated successful scans and the full AI pipeline remain unaccepted. [Cloudflare documents up to 15 minutes of cron propagation](https://developers.cloudflare.com/workers/configuration/cron-triggers/). Inspect subsequent scanner audit rows and office state before accepting repeated execution. The current Durable Object alarm handles cases/outbox/retention; market scanning is triggered by the cron handler.

An earlier first-deployment office-state read returned HTTP 500 and subsequent reads succeeded. Safe smoke-test reads now have five attempts with bounded delays for transient 5xx responses; persistent failures still reject deployment. Login/logout mutations are not retried by this helper.

The previous direct OpenAI attempt failed with HTTP 429 `insufficient_quota`. That historical failure no longer blocks the selected OpenRouter/Gemini configuration.

## Still requiring acceptance

- Fresh upstream candle ingestion and repeated successful scheduled scans; schedule installation and reaching the freshness guard are confirmed.
- Full real Worker case pipeline, configured failover, simulation and recovery observations.
- Real Discord webhook configuration and explicitly authorized delivery acceptance. Current deployed health reports `NOT_CONFIGURED`; no real delivery test was sent.
- Exchange tick-size verification; the existing display precision is not exchange evidence.
- Physical device/FPS and premium asset acceptance where required by the PRD.

Do not label all production/MVP acceptance complete until these results exist.
