# Production acceptance — reviewed 17 October 2026 (UTC)

**Status: deployed and automatically validated; full operational acceptance remains open.** A green deployment is evidence for its recorded checks, not approval of every MVP criterion. This report supersedes the [4 October report](PRODUCTION_ACCEPTANCE_2026-10-04.md).

## Verified release

- Repository revision: `cff88b7074f476739f2954221d70b5634e3013ff`.
- Worker: `byga-office`; production origin: https://karyawanai.muidsoft.com.
- [CI 38694557165](https://github.com/harvey-moeid/byga_office/actions/runs/38694557165), 15 October: code/Worker build and desktop/mobile browser jobs succeeded.
- [Deployment 38840278995, attempt 2](https://github.com/harvey-moeid/byga_office/actions/runs/38840278995), 16 October, completed at 03:22:08 UTC: **379 unit/integration tests, 165 browser tests and 30 browser–Worker/D1 tests passed**, alongside TypeScript, lint, dependency audit and build.
- Deployment applied `0009_history_deletions.sql` and `0010_strict_publication_policy.sql`; a SELECT-only ledger check on 17 October confirmed **all ten migrations, 0001–0010**. Application migrations target `trading_office_db`, never `chart_db`.
- Cloudflare GET on 17 October confirmed cron **`*/5 * * * *`**. The latest successful workflow restored it after initial deployed smoke passed.

## Deployment acceptance actually observed

| Check | Result and scope |
| --- | --- |
| Market | At 16 October 03:20:59 UTC, the real SELECT-only reader validated 260 closed candles for each H1/M15/M5, including OHLC, gaps and freshness. This is a time-bound snapshot. |
| Provider probes | OpenRouter `openai/gpt-4.1-mini` and Gemini `gemini-3.5-flash-lite` discovery and bounded structured inference passed in the GitHub runner. A deployed Workers AI binding/model probe also passed. These are synthetic probes, not full trading cases or configured failover acceptance. |
| Infrastructure/auth | Frontend, D1, Durable Object state, unauthorized Admin rejection, real Admin login, Secure/HttpOnly/SameSite cookie flags, wrong-origin rejection and logout invalidation passed. |
| Final smoke | Infrastructure, frontend, Durable Object, Admin controls and market passed. **Provider health was `DEGRADED`**, while Discord was `CONFIGURED`. The workflow permits provider degradation and does not claim it recovered. |
| Frontend integrity | Deployed JS/CSS hashes matched six built assets. |

The market preflight uses a warning policy for freshness lag; runtime trading guards remain strict. Structural market failures still reject deployment. The final smoke may accept freshness-only `DEGRADED` status, so a successful run alone is not continuous healthy operation.

## Read-only production observations — 17 October

Cloudflare queries used only SELECT and reported `rows_written=0`, `changed_db=false`. They did not create cases, call providers, change settings or send messages.

- The trailing 24-hour snapshot contained **18 LIVE scanner audit rows**. Repeated scans exist; uninterrupted five-minute cadence and upstream freshness still require observation over a defined operating window.
- Four recent LIVE cases ended safely: **two `NO_CONSENSUS` (`AI_QUORUM_REQUIRED`) and two `STALE` (`ANALYSIS_GROUPS_CHANGED_DURING_ANALYSIS`)**. This does not establish a successful strict-policy final signal.
- The same window contained **four recorded `MEETING` deliveries with `SENT` status**. Meeting delivery has real audit evidence; final `SIGNAL` delivery and duplicate-free recovery remain separate acceptance.
- Saved character settings contain provider/model mismatches: Risk uses Gemini with `openai/gpt-4.1-mini`, Momentum uses Mistral with that same OpenAI model, Volume uses Cohere with that model, and the Boss fallback pairs NVIDIA with a Gemini model. Review both paths for every character using that account's model catalog and a selected-model inference probe.
- Stored character-output audits include HTTP **400/404**, **402**, **429**, and missing-provider errors. These historical codes indicate model/request, quota/billing, rate or configuration problems; they do not identify every current account failure. No secret values or raw AI responses were retrieved.
- Direct anonymous application health could not be re-read from this workspace because the configured egress policy returned HTTP 403. The deployment smoke above is dated evidence, not a claim of current health.

## Remaining release acceptance

- [ ] Correct and verify both saved model/provider paths for every active character; confirm relevant provider circuits recover through successful inference.
- [ ] Observe fresh scheduled scans across an agreed continuous operating window; investigate gaps without relaxing freshness guards.
- [ ] Observe the real strict-policy case pipeline, approved final signal publication, configured failover, simulation isolation and recovery. Legitimate abstentions must remain abstentions.
- [ ] Verify final Discord signal delivery and duplicate-free/ambiguous-delivery recovery. Reuse existing delivery evidence when possible; do not send unsolicited acceptance messages.
- [ ] Verify exchange tick size rather than relying on the `0.01` fallback.
- [ ] Exercise backup/restore with the matching credential encryption root, prolonged outage recovery, retention scheduling and monitoring/alerts.
- [ ] Complete physical low/mid-range device touch/FPS and prolonged-session QA; browser emulation is separate evidence.
- [ ] Confirm GitHub environment protections and deployment token scope with operational access.

Use [the operations runbook](PRODUCTION_OPERATIONS.md) for repeatable checks and recovery. `npm run production:check` checks runtime health only and deliberately leaves end-to-end acceptance unassessed. New changes on the current development branch require their own CI/deployment evidence before replacing the verified revision above.

## Finalization branch validation — 17 October

The finalization change clears stale model IDs on provider changes, adds selected-model synthetic probes, requires successful inference before resetting a provider circuit, and adds the bounded read-only health command. The related Admin/API/credential browser suite passed **57 checks**, including the new scenario on desktop and both mobile orientations. After improving the save-feedback regression assertion, all **three targeted viewport checks** passed again. The complete browser–Worker/D1 suite passed **30 checks**. These use isolated fixtures, not paid providers or real Discord delivery.

Local `npm run check` passed TypeScript, ESLint, **387 tests across 31 files** and the production frontend build. The health/smoke regression subset passed all 17 tests after the last health-reader adjustment. Worker deployment dry-run also passed; it published nothing. The existing 3D chunk size warning remains (about 302 kB gzip) and does not substitute for physical performance QA.

The new runtime command was exercised against the production origin at 01:24:02 UTC and exited nonzero with `HEALTH_UNAVAILABLE` and all component states `UNKNOWN`, consistent with the workspace access limitation above. This result does not establish application downtime. Final branch CI and an actual deployment result are still required before treating these new changes as the verified production revision.
