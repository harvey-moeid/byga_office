# BYGA AI Trading Office

React + TypeScript + React Three Fiber frontend, Cloudflare Worker API, D1 audit database, and two persistent Durable Object orchestrators (live and simulation). Built against [PRD v1.0](BYGA_AI_TRADING_OFFICE_PRD.md). Progress is recorded in [the checklist](BYGA_AI_TRADING_OFFICE_CHECKLIST.md).

Production setup now has a verified Cloudflare account/chart schema, five applied remote application migrations, and a tracked nonsecret production target. CI passes 109 unit/integration tests and 30 desktop/mobile browser tests using isolated fixtures. Required production secrets and live candle validation now pass. Production deployment is blocked by OpenAI HTTP 429 `insufficient_quota` during real inference; this is not a completed production acceptance; see [the acceptance report](docs/PRODUCTION_ACCEPTANCE.md). See [deployment setup](docs/DEPLOYMENT.md) and [implementation status](docs/IMPLEMENTATION_STATUS.md).

## Local development

Use the existing checkout; cloud tasks are already isolated, so no Git worktree is needed. Requires Node 24 and npm; the repository includes a lockfile.

```sh
npm ci --cache /tmp/byga-npm-cache
npm run db:migrate
npm run build
npm run dev:api
```

The Worker serves the built frontend and versioned API together on port 8787. For frontend hot reload, run `npm run dev` in another terminal (port 5173, API proxy to 8787). Local development origins are explicitly allowlisted; staging/production mutations require the exact configured `PUBLIC_ORIGIN`.

The default Wrangler IDs are **local-only placeholders**. Local `chart_db` is empty until populated. To explore with clearly labelled synthetic candles:

```sh
npm run db:fixture
```

This command is explicitly `--local`; it never accesses or migrates the existing remote market database. It writes synthetic BTCUSDT candles to local `candles`, replacing overlapping fixture timestamps. Do not use it on a local database containing data you want to preserve. Refresh fixtures when they become stale. No scheduler fabricates new market data.

For Admin access, copy `.env.example` to the ignored `.dev.vars`. Generate a password hash with `npm run password:hash` (input hidden, minimum 12 characters), and put the resulting hash in `ADMIN_PASSWORD_HASH`. Do not commit the file. There is no default admin password. AI/provider and Discord variables are optional for read-only exploration, required for real calls. Configure provider/model per character in Admin. Never put keys in `VITE_*` variables.

## Verification

```sh
npm run check
npm run deploy:check
```

`check` runs strict TypeScript, ESLint, unit/integration tests, and the frontend build. Integration tests execute real workerd/D1/Durable Objects in isolated Miniflare storage, intercept outbound providers, and never use real AI keys/webhooks. No browser or production integration is implied by passing these tests.

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/byga-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/byga-browsers npm run test:browser
```

If a system Chromium is already installed, no browser download is necessary:

```sh
BYGA_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

Browser tests cover desktop/mobile layout, the 3D renderer, WebGL fallback, offline reconnect, scanner filters and Admin delivery review using explicitly intercepted API fixtures. The system Chromium command was exercised in this environment. Separate physical device/FPS and actual provider validation are still needed.

## Architecture

- `src/core`: OHLC validation, EMA/RSI/ADX/MACD/ATR/Bollinger/structure, six scanners, trigger, risk, voting, confidence, context compression.
- `src/server/market.ts`: SELECT-only market repository, validated SQL identifiers, configurable timestamp units/timeframe names, gap and freshness checks. Indicators read sufficient warm-up history; raw AI context defaults to 50/100/100.
- `src/server/office.ts`: durable live and independent simulation queues; immutable config/prompt snapshots; parallel Analysts; Risk Manager then Boss; persistent per-character outputs; revalidation/cooldown; atomic signal publication with cancellation protection.
- `src/server/providers.ts`: eight provider wire adapters, model discovery, timeout/retry/jitter, fallback, semantic warnings, persistent circuit state and half-open probe lease.
- `src/server/auth.ts`: PBKDF2-SHA256 hash verification, hashed random sessions, Secure/HttpOnly/SameSite cookies, expiry, persistent login throttling and same-origin mutations.
- `src/ui`: operational dashboard, scanners, signal filters, case audit, Admin/config/prompt rollback, emergency/simulation, lazily loaded primitive office and 2D fallback.
- `migrations`: application/audit tables and global WIB-day sequences. Never applied to `chart_db`.

Live and simulation use separate Durable Objects; IDs are allocated centrally in D1 to prevent collisions. A live case captures all configs, model choices, market and scanner snapshots; changes use NEXT CASE or confirmed APPLY NOW. Saved character outputs are reused on recovery. Crashes during an in-flight AI request may cause a repeated paid request; persisted responses prevent repeating completed stages. Remote provider calls cannot be made exactly-once.

The orchestrator persists a watchdog before processing cases, resumes unfinished cases with saved character outputs, and retries recognized temporary D1 errors up to three times with backoff. Idle maintenance removes expired raw prompts/responses and sessions while preserving structured audits. Exhaustive abrupt termination and infrastructure outage recovery still require further tests.

Discord uses a durable outbox with a unique case/kind key. Known success is not resent. A timeout, server error or Worker interruption becomes `UNKNOWN` until reviewed. Admin → Usage supports confirmed `MARK_SENT` and `DISMISS`, with a persistent review audit; retry is allowed only for definite `FAILED` deliveries. HTTP 429 respects retry delay and a four-attempt cap. An old queue creation timestamp no longer makes a newly claimed delivery look interrupted.

The scene uses procedural room/character meshes, bounded orbit/pan controls, obstacle-aware grid routes, animated limbs and decorative coffee activity. Quality selects low/medium/high profiles and steps down when measured FPS drops below 30; low quality reduces mesh detail and disables shadows/decorative motion. Repeated desk legs use instancing. A blocked route leaves a character at its last valid position. Character-to-character avoidance and premium GLB assets remain open. Trading runs entirely on the backend; browser decorations and Sholat do not invoke AI.

## Deployment

See [deployment and permission requirements](docs/DEPLOYMENT.md). `npm run deploy` requires a generated real staging/production configuration and rejects the local placeholder config. No production resource is created automatically during local setup.
