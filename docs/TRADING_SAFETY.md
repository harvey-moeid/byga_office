# Trading safety corrections

This change addresses all nine findings from the 10 October 2026 audit of
`ecf4f7c063b3f2fc56570f518e78a738e5d6bd13`. It improves processing and signal
correctness; it does not establish strategy profitability or a calibrated win rate.

| Audit finding | Implemented behavior |
| --- | --- |
| F1: duplicate processing across actors | Canonical Durable Object identity owns either LIVE or SIMULATION; alarm queries filter that mode. Concurrent alarms in one instance share one promise. |
| F2: queued AUTO bypasses cooldown | Revalidation and publication check cooldown and deduplicate the actual candle, direction and configuration. Persisted D1 triggers/final outcomes cover the gap before the storage anchor is written. |
| F3: obsolete market at publication | LIVE snapshots have a five-minute maximum age and are checked before inference and before publication. Changed candles, changed group evidence, unavailable data or expired snapshots stop the case. |
| F4: Emergency focus forces direction | Focus is context only. Emergency fallback requires deterministic group consensus; valid Analyst authority or a true Boss tie-break can still determine direction. Otherwise the case ends NO_CONSENSUS. |
| F5: cron misses the newly closed candle | Cron persists a pending scan for its scheduled time plus processing delay. Durable alarms consume the pending scan, and cleanup/watchdogs preserve its deadline. Candle readers retain closed-candle and delay guards. |
| F6: non-positive risk prices | Risk proposals require finite, positive, ordered prices and finite positive R:R after normalization. An invalid proposal cannot produce a signal. |
| F7: prompt-only Risk Manager authority | Server validation requires Risk Manager support for the selected direction and an existing proposal, or NO_TRADE. Any AI price levels must copy a supplied deterministic proposal exactly. Saved responses are validated again during recovery. |
| F8: prices outside the tick grid | Risk uses the snapshot's tick size (default 0.01). Published prices, R:R and LOW_RR all use the normalized levels. |
| F9: invalid indicator relationships | EMA periods must satisfy fast < middle < slow; momentum RSI BUY > SELL, and reversion oversold < overbought. Ordered non-default settings remain supported. |

## Policies and recovery

AUTO deduplication applies to the same configuration, direction and revalidated
M5 candle. Explicit Emergency requests remain separate investigations. FROM_TRIGGER
does not block a case for its own trigger anchor; newer triggers may supersede
older queued work. FROM_FINAL_DECISION uses published signal direction and time;
AUTO NO_CONSENSUS uses the trigger direction and completion time.

For LIVE decisions, `market_read_at` records when the market snapshot was captured
or revalidated. Legacy cases use their creation time. Refreshing a snapshot does
not retain old votes: a changed in-flight snapshot stops with STALE instead.
Derivatives are checked through their resulting group payload, direction and
strength; wall-clock evaluation timestamps are excluded from that comparison.
Historical SIMULATION is exempt from live expiry, and retains as-of market reading.
Already committed SIGNAL_CREATED cases resume delivery of the saved signal rather
than retroactively invalidating it.

Temporary recognized D1 failures retain the existing bounded recovery policy.
Completed saved AI responses are reused after schema and authority validation.
Invalid saved responses become UNAVAILABLE without another paid request; raw
provider records remain in the audit. An abrupt termination during an uncommitted
remote AI request can still repeat that request: providers do not offer an
exactly-once contract.

The entry band rounds outward; preferred entry rounds to the nearest tick. Stops
round away from entry and targets towards entry, preserving the structural target
rather than extending it to meet a minimum R:R. Ordering is checked again. A coarse
tick that collapses target and entry is rejected. Unsupported numerical precision
is rejected instead of emitting an approximate grid. LOW_RR and Risk/Boss
NO_TRADE remain advisory under the existing product rules.

These trading corrections alone require no database migration. The subsequent
UI/API synchronization adds `0006_admin_operations.sql`; see the
[UI/API contract and validation](API_UI_CONTRACT.md) for the combined release.
Existing configurations with reversed or equal
EMA/RSI relationships must be corrected; they are no longer accepted. Historical
signals are unchanged. Unfinished cases with invalid legacy settings fail without
blocking the queue; already committed signals still resume delivery. Known stop
reasons appear on case detail. Cancelled meetings close even when the renderer
has not reported a visible speaker. Public reasons use a bounded message map, never raw
provider/database errors.

## Verification

```sh
npm run check
npm run deploy:check
BYGA_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser -- --workers=1
```

`tests/trading-safety.test.ts` exercises actual workerd/D1/Durable Objects with
isolated storage and intercepted AI calls: concurrent actors/alarms, pending cron,
cooldown storage gaps, duplicate candles, Emergency voting, stale/changed/missing
market, derivative changes and saved-response recovery. Core/provider/market tests
cover tick grids, invalid prices, AI authority, parameter ordering and deterministic
H1/M15/M5 delay boundaries. Browser tests cover public stop explanations on desktop
and both mobile orientations. These checks do not call paid providers, deliver real
webhooks or deploy to production.

Local verification on 10 October 2026: all 253 unit/integration tests passed,
as did TypeScript, ESLint, production build and Worker deploy dry-run. The full
54-scenario browser run passed; after adding the cancellation guard, all six
targeted cancellation/meeting checks passed (three new scenarios, for 57 unique
browser scenarios verified across desktop and mobile). No production deployment
was performed.
