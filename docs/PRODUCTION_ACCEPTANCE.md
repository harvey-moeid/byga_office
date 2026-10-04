# Production acceptance — 4 October 2026 (UTC)

## Confirmed

- Code commit: `cb1b66a21f889d0df58ce8e8ca68bde695781b1d`.
- [CI 37182406627](https://github.com/harvey-moeid/byga_office/actions/runs/37182406627): success; **109 unit/integration tests**, **30 browser tests**, TypeScript, ESLint, frontend build and Worker dry run passed.
- Cloudflare connector verified the account, workers.dev subdomain and both database IDs.
- All five application migrations are applied remotely and recorded in `d1_migrations`. 22 application tables verified.
- Latest 260 closed candles per H1/M15/M5: zero gaps and zero invalid OHLC/volume rows. Chart queries were SELECT-only.
- Tracked production configuration and automated predeployment/deployed checks are committed.

## Deployment blocker

[Deployment 37182406624](https://github.com/harvey-moeid/byga_office/actions/runs/37182406624) failed in the credential preflight, before checkout/build/deployment. These GitHub `production` environment secrets are missing:

1. `CLOUDFLARE_API_TOKEN`
2. `ADMIN_PASSWORD` (minimum 12 characters)
3. `OPENAI_API_KEY`

Configure them at repository Settings → Environments → production → Environment secrets, then run Actions → Deploy approved environment → production. Runtime Admin hashing and Worker secret installation are handled by the workflow. Nonsecret account/database/schema/origin defaults are already tracked.

No production Worker was published, no real OpenAI inference occurred, and no real Discord message was sent by this task.

## Still requiring live acceptance

- Passing exact application-reader freshness checks; boundary snapshots can fail under the existing five-second tolerance.
- Exchange tick-size verification; the application's existing default precision is not exchange evidence.
- Production deploy and postdeploy frontend/assets/D1/Durable Object/authentication/cookie/origin/logout checks.
- Real OpenAI structured inference, full case pipeline, configured fallback, simulation and operational recovery observations.
- Real Discord webhook configuration and explicitly authorized delivery acceptance. Optional webhook secrets are documented; configuration alone does not prove delivery.
- Physical device/FPS and premium asset acceptance where required by the PRD.

Do not label production or all MVP integration acceptance complete until the relevant live results exist.
