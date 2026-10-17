# Production checks and recovery

## Runtime health

```sh
BYGA_PUBLIC_ORIGIN=https://karyawanai.muidsoft.com npm run production:check
```

This command only performs anonymous `GET /api/v1/health` requests. It retries at most three times, limits each request to ten seconds and bounds response size. It creates no Admin sessions, inference, cases or messages. Exit code 0 requires API, market and AI health `OK`, plus Discord `CONFIGURED`; degraded, missing, unknown or unreachable health returns exit code 1. The JSON report explicitly leaves full pipeline, failover, Discord delivery and physical-device acceptance `NOT_ASSESSED`. A configured webhook does not prove delivery.

Run this command from a network allowed to reach the production origin. A proxy denial is a check limitation, not proof the application is down. Read the latest [acceptance report](PRODUCTION_ACCEPTANCE.md) alongside the output. Archive timestamps, revision, deployment URL and evidence before accepting a release; do not replace results with unchecked checklist ticks.

## Provider failures

1. In Admin → AI Characters, inspect **both** provider/model pairs for each active role. Changing provider clears that path's old model; Workers AI supplies its pinned default. Choose a model belonging to the selected provider/account, using **Discover primary/fallback models** or an account-verified custom ID.
2. Use **Test primary/fallback model** to make one bounded synthetic inference request (512 output tokens, ten-second timeout). It can consume provider quota. Success verifies this selected model's structured response, creates no trading signal and sends no Discord message. Save the reviewed character configuration for future cases; existing case snapshots remain unchanged.
3. A successful catalog lookup alone reports `inference: NOT_TESTED` and leaves circuit failures intact. Only a successful inference probe can clear a circuit, and only if the credential version has not changed during the request. Generic **Test connection** in Providers remains a catalog check for external providers; Workers AI also probes its pinned model.
4. For HTTP 400/404, verify model ID, provider, structured-output support and request parameters. For 401/403, verify account access/key permissions. For 402 or quota-related 429, restore provider quota/billing; for rate-limit 429, review allowed traffic and retry policy. Do not erase failures merely to make health green.
5. Verify primary and fallback separately, then observe configured failover using an agreed bounded acceptance case. Do not change stored provider choices silently or rotate encryption roots to work around an account problem.

The default AI budgets are unlimited (`0`). Configure explicit case/call/token budgets in immutable Trading Config according to the operating budget before unattended use. The application does not prove strategy profitability or validate a provider's billing account through configuration alone.

## Failed deployment and cron

The workflow publishes initially with cron disabled. It enables the real schedule only when initial deployed smoke succeeds. A failure after the temporary publish can leave the new revision live with cron disabled; the workflow does **not** automatically roll back code, database migrations or secrets.

1. Inspect the failed run and identify whether temporary publication happened. Read the actual Worker schedule; do not infer its state from the workflow's final status.
2. Repair the failed binding, credential, model or application behavior. Keep automated trading paused while smoke fails. Check active/in-flight cases and delivery state; removing cron alone does not cancel existing Durable Object work.
3. Re-run the full deployment workflow for the reviewed revision. It repeats the validation and smoke gates before restoring cron. Do not unconditionally restore cron in an `always()` step.
4. Verify final deployed smoke, asset hashes, the actual `*/5 * * * *` schedule, and subsequent scanner rows. A trigger's presence is separate from successful repeated scans.

For a manual deployment, generate the reviewed staging/production config with `scripts/configure.mjs`, apply application migrations only, and follow the same initial smoke and schedule gates. Do not use the local placeholder Wrangler config for production. A rollback needs an explicit compatible revision/configuration and database recovery plan; applying migrations before publication is not an automatic database rollback.

## Recovery and final acceptance

- Preserve both application D1 backups and the corresponding `PROVIDER_KEYS_ENCRYPTION_KEY`; encrypted credentials require the matching root. Exercise restoration in staging before claiming restore readiness.
- During provider/D1 outages, inspect queue/case transitions, freshness rejection and recovery audits. Record whether a paid request can repeat after interruption; exactly-once remote inference is not guaranteed.
- Review `UNKNOWN` Discord deliveries against the receiving channel before retrying; use the existing audited Admin review controls. Final delivery tests need an intended test destination and an agreed case.
- Observe retention and resource/budget usage over time. Monitor degraded market/provider health, stale queues and failed/ambiguous deliveries.
- On physical low/mid-range devices, record portrait/landscape touch behavior, FPS, WebGL fallback and prolonged-session resource behavior. Browser emulation does not close this criterion.
