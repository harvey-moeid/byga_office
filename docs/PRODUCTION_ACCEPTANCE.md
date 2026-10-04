# Production acceptance — 4 October 2026 (UTC)

## Confirmed

- Code commit: `9345f9a3d34aab949095f12c99e3afdbaefff667`.
- [CI 37183388465](https://github.com/harvey-moeid/byga_office/actions/runs/37183388465): success; **109 unit/integration tests**, **30 browser tests**, TypeScript, ESLint, frontend build and Worker dry run passed.
- All three required GitHub production secrets are present and pass preflight. Admin password meets the minimum length. Secret values were not exposed.
- Cloudflare account, workers.dev subdomain and both database IDs were verified.
- All five application migrations are applied remotely and recorded in `d1_migrations`. 22 application tables verified. No migrations or seeds were applied to `chart_db`.
- Actual application market reader passed through the supplied Cloudflare API token at 06:34:08 and 06:41:08 UTC: 260 closed BTCUSDT candles per H1/M15/M5, OHLC/volume, gaps and freshness. Queries were SELECT-only and verified not to write data. These are point-in-time checks; boundary ingestion lag can still cause strict freshness rejection.
- Real OpenAI model discovery passed, including availability of `gpt-4.1-mini`.
- Live inference diagnostics log only allowlisted error codes/types and HTTP status. Only identified temporary rate limits receive bounded retries; quota errors stop immediately.
- Tracked production configuration and automated predeployment/deployed checks are committed.
- The production Worker target is now `byga-office` at `https://byga-office.harveymoeid.workers.dev`; staging uses `byga-office-staging`. This naming change does not establish deployment acceptance.

## Current provider selection

Production now requires `OPENROUTER_API_KEY` (primary) and `GEMINI_API_KEY` (fallback), along with the existing Cloudflare deployment token and Admin password. The workflow no longer requires a direct OpenAI key. Default models are `openai/gpt-4.1-mini` through OpenRouter and `gemini-3.5-flash-lite` through Gemini; both receive real discovery/inference probes before deployment. New character seeds use this selection; stored character settings remain editable in Admin.

Live validation of the newly selected credentials has not passed yet. Add these two GitHub `production` secrets, then run Deploy approved environment on latest main. Successful fixture tests do not establish provider account access or inference acceptance.

## Previous OpenAI deployment blocker

[Deployment 37183388460](https://github.com/harvey-moeid/byga_office/actions/runs/37183388460) passed credentials, all code/browser checks and the real market reader, then failed on its first structured inference request:

```
provider: openai
http_status: 429
type: insufficient_quota
attempt: 1
```

The provider's specific code was not in the logging allowlist and was reported as `unclassified`; the exact credit/spend/usage-limit cause was not established. This is no longer a missing-secret failure. Check billing balance and enforced usage/spend limits for the organization/project owning `OPENAI_API_KEY`. Restore API access or replace that GitHub production secret with a key belonging to a funded project.

Official guidance: [OpenAI 429 troubleshooting](https://help.openai.com/en/articles/5955604-troubleshooting-api-rate-limits-and-429-errors). Retrying quota/billing errors does not restore access.

After fixing API access, run Actions → Deploy approved environment → production on the latest main revision (or re-run a deployment of that revision). Older runs target the previous Worker name. The workflow retains its required real-inference gate, then performs app-only migrations, deployment with cron disabled, runtime secret installation, deployed smoke checks and final cron activation.

No BYGA production Worker exists at the latest Cloudflare check. No successful real inference or real Discord delivery occurred. Worker write/deploy permissions and deployed acceptance are still unverified because execution stopped before those steps. Discord webhook environment variables were empty in this run.

## Still requiring live acceptance

- Exchange tick-size verification; the application's existing default precision is not exchange evidence.
- Production deploy and postdeploy frontend/assets/D1/Durable Object/authentication/cookie/origin/logout checks.
- Successful OpenRouter and Gemini structured inference, full case pipeline, configured fallback, simulation and operational recovery observations.
- Real Discord webhook configuration and explicitly authorized delivery acceptance. Configuration alone does not prove delivery.
- Physical device/FPS and premium asset acceptance where required by the PRD.

Do not label production or all MVP integration acceptance complete until the relevant live results exist.
