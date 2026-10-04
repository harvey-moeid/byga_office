# Implementation status — 4 October 2026 (WIB)

Initial implementation against PRD v1.0. The checklist uses `[x]` for implemented features with relevant local verification, `[~]` for initial implementation awaiting further functional/browser/provider validation, and `[ ]` for work not done or external resources not connected. This is not a declaration that the entire production MVP is complete.

| Area | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Foundation | Node 24/npm lockfile; React/TypeScript/Vite; Worker bundling; local D1 migrations; CI and guarded deploy scripts | Real Cloudflare account, separate staging/production DBs and live market schema |
| Authentication | Password-hash verification, Secure/HttpOnly/SameSite session, origin check, expiry/logout, persistent throttling tested in workerd | User-configured password hash; deployed/browser cookie QA |
| Market | SELECT-only reader, numeric UTC seconds/milliseconds, H1/M15/M5 closed candles, gap/freshness validation, precision/WIB helpers tested | Existing `chart_db` binding/schema; other timestamp formats require an extension |
| Trading | Indicators, six always-active scanner contracts, unique trigger, cooldown, structural risk, fixed-denominator voting/confidence | Strategy-specific scanner/structure regression coverage and calibration |
| Case lifecycle | D1 queue, revalidation, stale/no-AI behavior, direction change/new ID, cancellation, idempotent publication, separate simulation actor; watchdog, interrupted-stage/output reuse, bounded temporary D1 recovery and signal-publication recovery tested | Abrupt process termination during a paid request, prolonged infrastructure outage and queue recovery stress tests |
| AI | Eight wire adapters verified with fixtures; retry/fallback, semantic quality flags, Boss authority, circuit, native JSON/prompt JSON | Real model discovery/inference, provider/model-specific structured-output support, timeout and pricing/budget observations |
| Signals/Discord | Persisted signal snapshots, public toggles/history/scanner filters, private UUID/debug redaction; unique outbox, LOW_RR, retry delay/cap, confirmed Admin review/audit and ambiguous-send protection tested | Real webhooks and production delivery observations |
| Simulation/emergency | Full backend flow; emergency focus does not force vote; simulation result excluded from live signals; STRICT replay pins historical model identities and fails when unavailable (tested) | Browser playback and historical failure UX QA; real historical provider validation |
| 2D/3D UI | Chromium desktop/portrait/landscape tests; renderer and native context-loss fallback, offline reconnect, narrow navigation, scanner filters, Admin review; obstacle-aware routes for all eight actors, animated limbs, coffee activity, geometry detail/instancing and FPS-triggered quality reduction | Premium assets/rigged animations, character-to-character avoidance, physical touch/device/FPS QA and further visual polish |
| Usage/retention | WIB day counters, atomic daily quotas, reserved tokens/case; idle retention clears expired raw/prompt/session data while preserving structured audits (tested), daily maintenance and due-outbox alarms | Long-term scheduling/failure stress tests and deployed counters |

## Current build validation — 4 October 2026 (UTC)

- Added configurable `closed` chart column filtering with the observed `is_closed` flag; SELECT-only and cutoff/freshness guards remain. Integration fixtures now use `open_time` in milliseconds plus `is_closed`. No remote data changed.
- Added optional structured AI price levels and BUY/SELL price relationship checks; persistent semantic failure still preserves the last vote/confidence under the PRD policy.
- Added atomic persistent API budgets (240 reads / 30 mutations per IP per 60-second window), hashed keys, 429/retry headers and expiry cleanup. Migration 0005 targets the application database only and has not been applied remotely. Missing trusted IP uses one shared fallback budget; limits are per IP, so users behind one NAT share a budget.
- Split Admin/Simulation routes into lazy modules, and added explicit Admin-only provider/model metadata in case/character views.
- TypeScript, ESLint and production build passed. Admin chunk: 3.90 kB gzip; Simulation chunk: 1.63 kB gzip; main JS: 104.78 kB gzip; 3D: 248.85 kB gzip.
- 66 unit tests passed. The 34-test integration suite could not start because sandbox loopback listening is blocked (`listen EPERM`). Requests for additional permissions stopped before execution; this is not a passing integration result. Three browser scenarios were added (lazy routes, APPLY NOW confirmation, metadata privacy); the current 30 browser executions have not run.
- Previous full checks below belong to the earlier implementation, not this revision. Rate limiting and Admin metadata remain awaiting integration/browser acceptance.

## Earlier validation performed

- `npm run check`: strict TypeScript, ESLint, **84 unit/integration tests**, frontend build passed.
- `BYGA_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser`: **21 browser tests** across desktop, emulated Pixel 7 portrait/landscape passed. All ran; none skipped. Browser APIs are intercepted fixtures. Physical Android/device performance acceptance is separate.
- `npm run deploy:check`: Worker bundle/static assets/D1/Durable Object configuration passed dry-run; no deployment.
- `npm ci --cache /tmp/byga-npm-cache`: frozen installation exercised.
- All four D1 migrations applied locally; migration repeatability checked. Migration 0004 adds delivery claim/retry timestamps and permanent review audits.
- The complete cloud install script was executed successfully: Node 24 check, frozen npm installation, frontend build, and repeatable local application migration. Setup/start instructions, deployment variable requirements and the scoped Cloudflare token requirement were saved in the environment configuration draft; this does not apply or publish the configuration.
- Local Worker startup: HTML shell and versioned API returned expected responses, H1/M15/M5 synthetic fixture data loaded, scheduled scanner returned 200 and produced six outputs; unauthorized Admin returned 401.
- Integration tests use isolated Miniflare/workerd with synthetic candles and intercepted AI/Discord. Scenarios include BUY/SELL, abstention, AI tie, semantic/Boss rejection, fallback/full outage, APPLY NOW, duplicate scans/cases, stale/direction-changed queue, simulation isolation, LOW_RR, public toggles, quota, login throttling/expiry, object eviction, interrupted-stage/output reuse, bounded D1 retries, retention, signal-publication recovery, scanner filtering, Discord ambiguity, 429 delay/cap and Admin review. Test-only alarm controls are bundled from `tests/worker-harness.ts`; they are absent from the production Worker entry point.

## Not executed / blocked

The earlier browser download returned `403 Domain forbidden` for `cdn.playwright.dev`. System Chromium was subsequently found at `/usr/bin/chromium`, enabling real browser execution without another download. Additional CDN domains remain saved in the cloud draft for machines requiring a download; saving does not apply the policy. Physical device/FPS QA remains open.

Native WebGL context-loss tests found a DOM cleanup error in 3D labels during fallback. Labels now use a dedicated portal host; native context-loss transitions pass without page errors.

The supplied Cloudflare account and both database IDs were subsequently verified via connector GET/SELECT calls. The remote chart schema uses candles.open_time in milliseconds, H1/M15/M5 timeframe values and an is_closed flag. trading_office_db has only an internal table and has not been migrated. See [the verification report](CLOUDFLARE_VERIFICATION.md) and [schema snapshot](chart_db.schema.sql). The environment token is reported ready but remains unverified via API because shell network requests could not complete. Connector token verification endpoints returned Invalid API Token despite successful D1 reads; this does not establish the environment token's validity. Environment assignment, HTTPS origin, application secrets, real market freshness/gaps and deployed acceptance remain open. All remote SQL was SELECT-only with rows_written=0 and changed_db=false. No remote resources were created/migrated, no paid AI inference was made, and no real Discord message was sent.

The development Worker was restarted after the frozen installation and passed the HTML/API/scanner/unauthorized-Admin smoke checks again. Restoration in a fresh cloud task has not been verified; running processes must restart.

The 3D chunk is about 249 kB gzip and lazy-loaded separately from the shell (about 108 kB JS gzip). The build still warns about the uncompressed 3D chunk exceeding 500 kB. Premium asset/model optimization and physical device performance have not been claimed complete.
