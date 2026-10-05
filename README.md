# BYGA AI Trading Office

React + TypeScript + React Three Fiber frontend, Cloudflare Worker API, D1 audit database, and two persistent Durable Object orchestrators (live and simulation). Built against [PRD v1.0](BYGA_AI_TRADING_OFFICE_PRD.md). Progress is recorded in [the checklist](BYGA_AI_TRADING_OFFICE_CHECKLIST.md).

Production presents the logical market **BTCUSDT.P**, while the read-only `chart_db` stores the corresponding source symbol as **BTCUSDT**. Repository configuration schedules the Worker every five minutes (`*/5 * * * *`) and the deployment workflow validates real market freshness, provider inference, application smoke checks, and frontend integrity before completing. Historical production observations remain in the acceptance report; the latest deployment result is the source of truth for whether a new revision is live. See [required environment variables](docs/ENVIRONMENT.md), [the acceptance report](docs/PRODUCTION_ACCEPTANCE.md), [deployment setup](docs/DEPLOYMENT.md), and [implementation status](docs/IMPLEMENTATION_STATUS.md).

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

This command is explicitly `--local`; it never accesses or migrates the existing remote market database. It writes synthetic BTCUSDT.P candles to local `candles`, replacing overlapping fixture timestamps. Do not use it on a local database containing data you want to preserve. Refresh fixtures when they become stale. No scheduler fabricates new market data.

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

## Home

`/` opens the full-viewport 3D office with floating navigation and camera controls; `/office` redirects there. Market/scanner cards and charts remain on `/operations`. The charcoal/emerald/amber palette combines a dark stage with warm oak/walnut furniture. Meeting chairs and characters share one seating plan and face across the table. WebGL loss keeps an interactive 2D fallback.

## Architecture

Admin → Trading Config → **Minimal Group Consensus** controls four deterministic groups: **SMC/ICT**, **Indicators**, **Volume**, and **Derivatives / Market Positioning**. Automatic analysis starts only when the configured minimum aligns in one direction (default **2 of 4**). Group 4 reads Open Interest, Funding Rate, Liquidation, and Long/Short Ratio from the read-only `chart_db.derivative_metrics` dataset and resolves to `NONE` when fresh positioning data is insufficient. The six deterministic scanners remain telemetry/audit inputs and do not vote directly on the AUTO trigger. Revalidation and simulations use the same group rule.

- `src/core`: OHLC validation, EMA/RSI/ADX/MACD/ATR/Bollinger/structure, six telemetry scanners, four deterministic analysis groups, configurable group trigger, risk, voting, confidence, context compression.
- `src/server/market.ts`: SELECT-only candle and derivative repository, validated candle SQL identifiers, configurable timestamp units/timeframe names, gap/freshness checks, plus read-only `derivative_metrics` enrichment. Indicators read sufficient warm-up history; raw AI context defaults to 50/100/100.
- `src/server/office.ts`: durable live and independent simulation queues; immutable snapshots; two specialist Analysts per group (SMC/ICT, Indicators, Volume, Derivatives/Positioning); Risk Manager then Boss; persistent per-character outputs; revalidation/cooldown; atomic BUY/SELL signal publication with cancellation protection.
- `src/server/providers.ts`: nine provider adapters including Cloudflare Workers AI, model discovery, timeout/retry/jitter, fallback, semantic warnings, persistent circuit state and half-open probe lease.
- `src/server/auth.ts`: PBKDF2-SHA256 hash verification, hashed random sessions, Secure/HttpOnly/SameSite cookies, expiry, persistent login throttling and same-origin mutations.
- `src/ui`: operational dashboard, scanners, signal filters, case audit, Admin/config/prompt rollback, emergency/simulation, lazily loaded primitive office and 2D fallback.
- `migrations`: application/audit tables and global WIB-day sequences. Never applied to `chart_db`.

Analyst specialization is fixed while provider/model choice remains configurable per character: **structure + liquidity → SMC/ICT**, **trend + momentum → Indicators**, **volume + quant → Volume**, and **derivatives + positioning → Derivatives / Market Positioning**. Each pair receives only its assigned deterministic snapshot plus a bounded recent-candle context. Risk Manager and Boss receive the consolidated group/analyst result. Discord output includes group composition for auditability.

Live and simulation use separate Durable Objects; IDs are allocated centrally in D1 to prevent collisions. A live case captures all configs, model choices, market and scanner snapshots; changes use NEXT CASE or confirmed APPLY NOW. Saved character outputs are reused on recovery. Crashes during an in-flight AI request may cause a repeated paid request; persisted responses prevent repeating completed stages. Remote provider calls cannot be made exactly-once.

The orchestrator persists a watchdog before processing cases, resumes unfinished cases with saved character outputs, and retries recognized temporary D1 errors up to three times with backoff. Idle maintenance removes expired raw prompts/responses and sessions while preserving structured audits. Exhaustive abrupt termination and infrastructure outage recovery still require further tests.

Discord uses a durable outbox with a unique case/kind key. Known success is not resent. A timeout, server error or Worker interruption becomes `UNKNOWN` until reviewed. Admin → Usage supports confirmed `MARK_SENT` and `DISMISS`, with a persistent review audit; retry is allowed only for definite `FAILED` deliveries. HTTP 429 respects retry delay and a four-attempt cap. An old queue creation timestamp no longer makes a newly claimed delivery look interrupted.

The office is a furnished architectural cutaway with oak/walnut materials, glass partitions and door openings, dual-monitor workstations, a meeting area, lobby, pantry, ventilated server racks, cabinets and plants. The current visual layer is hybrid: deterministic architecture and navigation stay procedural, while medium/high/ultra quality use local GLTF hero furniture for executive/meeting chairs and the lounge sofa; low quality keeps a lightweight procedural fallback. The front facade now carries **BYGA OFFICE** signage, warm architectural pendants and linear lights, a premium miniature plinth, glass entry doors, and a lounge mantra panel. All assets are served locally from `public/models/byga`; no third-party model CDN is required. Adult-proportion procedural characters retain shaped faces, hair, jacket lapels, hands and articulated knees/elbows; they sit and type at desks, stand and walk to meetings, and carry coffee during idle activity. Overview, analyst, meeting and boss camera presets complement orbit/pinch controls. Reflection lighting, physical glass/clearcoat materials and wood grain are generated locally. Quality automatically reduces detail/shadows below 30 FPS in Auto mode; manual Low/Medium/High/Ultra selection is persisted. Movement footprints still share the deterministic partition/furniture plan, so visual upgrades do not alter trading workflow or meeting routing. Fully rigged external character GLBs and character-to-character avoidance remain future work. Trading runs entirely on the backend; browser decorations do not invoke AI.

## Deployment

See [required environment variables](docs/ENVIRONMENT.md) and [deployment and permission requirements](docs/DEPLOYMENT.md). `npm run deploy` requires a generated real staging/production configuration and rejects the local placeholder config. No production resource is created automatically during local setup.


## 3D Realism Upgrade (2026-10-05)

The public home scene now targets a premium miniature-diorama look while keeping the office fully interactive.

- Hybrid rendering stays in place: deterministic React Three Fiber architecture/routing plus local GLTF hero furniture.
- Front branding is **BYGA OFFICE** with `TRADING · BTC · GOLD · FX`.
- Added a dedicated **Cinematic** camera preset alongside overview, analyst floor, meeting room, and boss-office views.
- Added contact grounding on medium/high/ultra quality so furniture and characters read as physically placed in the miniature instead of floating.
- Premium architecture now includes warm wood-slat feature walls, reception console, layered architectural lighting, premium planters, glass/metal details, and richer lobby frontage.
- Existing meeting logic remains authoritative: meeting events override ambient office activity, move participating staff into the meeting room, and restore the previous camera/activity state afterward.
- Quality selector remains available for mobile/desktop balance: Auto, Low, Medium, High, and Ultra.
- Low quality continues to use the lighter procedural fallback; richer GLTF furniture and premium accents are enabled on decorative quality profiles.

The realism work intentionally avoids changing navigation obstacles and meeting routing so visual upgrades do not introduce character collision regressions.
