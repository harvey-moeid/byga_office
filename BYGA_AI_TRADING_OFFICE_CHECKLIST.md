# CHECKLIST — BYGA AI Trading Office

Checklist implementasi MVP berdasarkan PRD v1.0.

Legend:
- [ ] Belum
- [x] Selesai
- [~] Sedang dikerjakan

---

# Milestone 0 — Repository & Project Setup

- [ ] Buat/siapkan repository `byga-trading-office`
- [ ] Tentukan package manager
- [ ] Setup React frontend
- [ ] Setup Cloudflare Workers backend
- [ ] Setup TypeScript
- [ ] Setup linting
- [ ] Setup formatting
- [ ] Setup environment separation dev/staging/prod
- [ ] Setup Wrangler configuration
- [ ] Setup CI build
- [ ] Setup basic deployment pipeline
- [ ] Buat `.env.example` tanpa secret nyata
- [ ] Dokumentasikan local development

---

# Milestone 1 — Cloudflare Foundation

## D1

- [ ] Bind existing `chart_db`
- [ ] Pastikan `chart_db` digunakan read-only
- [ ] Buat `trading_office_db`
- [ ] Buat migration system
- [ ] Buat tabel `cases`
- [ ] Buat tabel `signals`
- [ ] Buat tabel `scanner_runs`
- [ ] Buat tabel `scanner_outputs`
- [ ] Buat tabel `ai_runs`
- [ ] Buat tabel `ai_character_outputs`
- [ ] Buat tabel `risk_runs`
- [ ] Buat tabel `boss_decisions`
- [ ] Buat tabel `trading_config_versions`
- [ ] Buat tabel `prompt_versions`
- [ ] Buat tabel `character_configs`
- [ ] Buat tabel `provider_configs`
- [ ] Buat tabel `simulation_runs`
- [ ] Buat tabel `discord_deliveries`
- [ ] Buat tabel `usage_daily`
- [ ] Buat tabel `system_state`

## R2

- [ ] Buat/bind R2 bucket untuk 3D assets
- [ ] Tentukan folder structure asset
- [ ] Setup cache headers
- [ ] Setup asset versioning

## Secrets

- [ ] Tambahkan `OPENAI_API_KEY`
- [ ] Tambahkan `GEMINI_API_KEY`
- [ ] Tambahkan `GROQ_API_KEY`
- [ ] Tambahkan `OPENROUTER_API_KEY`
- [ ] Tambahkan `MISTRAL_API_KEY`
- [ ] Tambahkan `HF_TOKEN`
- [ ] Tambahkan `COHERE_API_KEY`
- [ ] Tambahkan `NVIDIA_API_KEY`
- [ ] Tambahkan Discord Meeting Webhook secret
- [ ] Tambahkan Discord Signal Webhook secret
- [ ] Pastikan secret tidak terekspos ke client

---

# Milestone 2 — Admin Authentication

- [ ] Buat halaman login Admin
- [ ] Implement password hashing
- [ ] Implement secure session
- [ ] Gunakan HttpOnly cookie
- [ ] Gunakan Secure cookie
- [ ] Gunakan SameSite cookie
- [ ] Implement session expiry
- [ ] Implement logout
- [ ] Implement login rate limiting
- [ ] Proteksi semua Admin API
- [ ] Pastikan public route tidak bocorkan config sensitif
- [ ] Tambahkan middleware authorization

---

# Milestone 3 — Market Data Layer

- [ ] Buat read-only repository untuk `chart_db`
- [ ] Implement query candle BTCUSDT H1
- [ ] Implement query candle BTCUSDT M15
- [ ] Implement query candle BTCUSDT M5
- [ ] Pastikan hanya closed candle digunakan
- [ ] Implement timestamp normalization UTC
- [ ] Implement display conversion WIB
- [ ] Implement dynamic price precision
- [ ] Implement latest candle query
- [ ] Implement historical snapshot query
- [ ] Implement data validation
- [ ] Implement missing candle handling
- [ ] Buat `/api/v1/market/status`
- [ ] Test bahwa Trading Office tidak pernah menulis ke `chart_db`

---

# Milestone 4 — Trading Configuration Versioning

- [ ] Definisikan Trading Config schema
- [ ] Buat default `TRADING-CONFIG-v1`
- [ ] Implement immutable config snapshot
- [ ] Implement version increment
- [ ] Simpan scanner params
- [ ] Simpan ATR params
- [ ] Simpan Entry Zone params
- [ ] Simpan SL params
- [ ] Simpan TP params
- [ ] Simpan minimum R:R
- [ ] Simpan confidence weights
- [ ] Simpan MTF weights
- [ ] Simpan NEUTRAL score
- [ ] Simpan cooldown settings
- [ ] Simpan AI candle context settings
- [ ] Implement `NEXT CASE`
- [ ] Implement `APPLY NOW`
- [ ] Implement confirmation dialog untuk APPLY NOW
- [ ] Implement cancel active case sebagai `CONFIG_CHANGED`
- [ ] Implement restart sebagai Case ID baru

---

# Milestone 5 — Indicator & Structure Engine

- [ ] Implement EMA 20
- [ ] Implement EMA 50
- [ ] Implement EMA 200
- [ ] Implement ADX
- [ ] Implement RSI
- [ ] Implement MACD
- [ ] Implement ROC
- [ ] Implement Bollinger Bands
- [ ] Implement ATR
- [ ] Implement volume metrics
- [ ] Implement swing high/low detection
- [ ] Implement HH/HL
- [ ] Implement LH/LL
- [ ] Implement BOS
- [ ] Implement CHoCH
- [ ] Implement support/resistance detection
- [ ] Implement liquidity high/low
- [ ] Implement liquidity sweep detection
- [ ] Implement FVG detection
- [ ] Implement order-block approximation
- [ ] Implement breakout detection
- [ ] Implement retest detection
- [ ] Tambahkan unit test indicator
- [ ] Tambahkan unit test structure detection

---

# Milestone 6 — Six Deterministic Scanners

## Trend Scanner

- [ ] Implement H1 bias
- [ ] Implement M15 setup
- [ ] Implement M5 trigger
- [ ] Implement BUY rule
- [ ] Implement SELL rule
- [ ] Implement NONE rule
- [ ] Implement reasons[]
- [ ] Implement levels[]
- [ ] Implement strength informational
- [ ] Simpan indicator snapshot

## Breakout & Retest Scanner

- [ ] Implement breakout detection
- [ ] Implement retest validation
- [ ] Implement S/R context
- [ ] Implement ATR context
- [ ] Implement volume confirmation
- [ ] Implement BUY/SELL/NONE
- [ ] Implement reasons[]
- [ ] Simpan indicator snapshot

## Momentum Scanner

- [ ] Implement RSI logic
- [ ] Implement MACD logic
- [ ] Implement ROC logic
- [ ] Implement candle momentum
- [ ] Implement volume momentum
- [ ] Implement BUY/SELL/NONE
- [ ] Implement reasons[]
- [ ] Simpan indicator snapshot

## Mean Reversion Scanner

- [ ] Implement Bollinger logic
- [ ] Implement RSI overextension
- [ ] Implement deviation metric
- [ ] Implement mean reversion rules
- [ ] Implement BUY/SELL/NONE
- [ ] Implement reasons[]
- [ ] Simpan indicator snapshot

## Market Structure Scanner

- [ ] Implement HH/HL state
- [ ] Implement LH/LL state
- [ ] Implement BOS
- [ ] Implement CHoCH
- [ ] Implement structural bias
- [ ] Implement BUY/SELL/NONE
- [ ] Implement reasons[]
- [ ] Simpan structure snapshot

## Liquidity / SMC Scanner

- [ ] Implement liquidity levels
- [ ] Implement sweep detection
- [ ] Implement FVG
- [ ] Implement order-block approximation
- [ ] Implement displacement logic
- [ ] Implement BUY/SELL/NONE
- [ ] Implement reasons[]
- [ ] Simpan structure snapshot

## Scanner Common

- [ ] Buat common scanner interface
- [ ] Validasi structured output
- [ ] Simpan config version
- [ ] Simpan candle timestamp
- [ ] Simpan reasons untuk NONE
- [ ] Buat scanner history query
- [ ] Buat scanner unit tests

---

# Milestone 7 — M5 Scheduler & Trigger Engine

- [ ] Detect closed M5 candle
- [ ] Tambahkan short processing delay
- [ ] Implement `last_processed_candle`
- [ ] Cegah duplicate scan
- [ ] Run semua 6 scanner
- [ ] Hitung BUY count
- [ ] Hitung SELL count
- [ ] Hitung NONE count
- [ ] Require minimum 2 same-direction scanner
- [ ] Require unique directional majority
- [ ] Tie → no trigger
- [ ] Implement WATCHING state
- [ ] Implement TRIGGERED state
- [ ] Implement directional cooldown
- [ ] Default cooldown 15 menit
- [ ] BUY/SELL cooldown terpisah
- [ ] Implement `FROM_TRIGGER`
- [ ] Implement `FROM_FINAL_DECISION`
- [ ] Default `FROM_TRIGGER`

---

# Milestone 8 — Case Engine & Queue

- [ ] Buat internal UUID
- [ ] Buat human Case ID
- [ ] Format `CASE-YYYYMMDD-XXXX`
- [ ] Reset sequence setiap 00:00 WIB
- [ ] Jangan reuse nomor
- [ ] Implement single active live case
- [ ] Implement pending queue
- [ ] Persist queue state
- [ ] Implement queue revalidation
- [ ] Re-run scanners sebelum queued case diproses
- [ ] Invalid setup → `STALE/CANCELLED`
- [ ] Direction berubah → `DIRECTION_CHANGED`
- [ ] Buat Case ID baru untuk arah baru
- [ ] Implement `AI_DEGRADED`
- [ ] Implement `NO_CONSENSUS`
- [ ] Implement `CONFIG_CHANGED`
- [ ] Implement failure recovery
- [ ] Implement idempotency key
- [ ] Test duplicate request handling

---

# Milestone 9 — AI Provider Abstraction

- [ ] Buat common AI provider interface
- [ ] Implement OpenAI adapter
- [ ] Implement Gemini adapter
- [ ] Implement Groq adapter
- [ ] Implement OpenRouter adapter
- [ ] Implement Mistral adapter
- [ ] Implement Hugging Face adapter
- [ ] Implement Cohere adapter
- [ ] Implement NVIDIA adapter
- [ ] Implement dynamic model discovery
- [ ] Implement Custom Model ID
- [ ] Implement provider-specific error normalization
- [ ] Implement token usage extraction jika tersedia
- [ ] Implement structured output capability detection
- [ ] Implement fallback JSON parser
- [ ] Implement timeout
- [ ] Implement configurable retry
- [ ] Default primary retry = 1
- [ ] Default fallback retry = 1
- [ ] Implement exponential backoff
- [ ] Implement jitter
- [ ] Implement fallback provider/model
- [ ] Implement `MODEL_FALLBACK_USED`
- [ ] Implement provider health state
- [ ] Implement manual Test Connection

---

# Milestone 10 — Circuit Breaker

- [ ] Implement per-provider circuit breaker
- [ ] Default threshold 3 consecutive failures
- [ ] Default cooldown 5 menit
- [ ] Implement CLOSED
- [ ] Implement OPEN
- [ ] Implement HALF_OPEN
- [ ] OPEN → skip primary
- [ ] OPEN → langsung fallback
- [ ] HALF_OPEN test flow
- [ ] Success → CLOSED
- [ ] Failure → OPEN
- [ ] Expose detail Admin-only

---

# Milestone 11 — Prompt System

- [ ] Buat locked Core Role Prompt per karakter
- [ ] Buat Custom Instructions editable
- [ ] Buat Personality editable
- [ ] Buat locked output schema
- [ ] Implement prompt rendering
- [ ] Implement prompt versioning
- [ ] Implement rollback prompt version
- [ ] Simpan `prompt_version`
- [ ] Simpan structured input snapshot
- [ ] Simpan rendered prompt dengan retention
- [ ] Redact secrets
- [ ] Buat default prompt 8 karakter

---

# Milestone 12 — AI Context Builder

- [ ] Default H1 = 50 candle
- [ ] Default M15 = 100 candle
- [ ] Default M5 = 100 candle
- [ ] Jadikan jumlah candle configurable
- [ ] Build scanner context
- [ ] Build indicator context
- [ ] Build MTF context
- [ ] Implement smart context compression
- [ ] Prioritaskan candle terbaru
- [ ] Summarize candle lama
- [ ] Implement safe truncate
- [ ] Simpan `context_compressed`

---

# Milestone 13 — Six AI Analysts

- [ ] Buat Trend Analyst
- [ ] Buat Structure Analyst
- [ ] Buat Momentum Analyst
- [ ] Buat Liquidity Analyst
- [ ] Buat Volume Analyst
- [ ] Buat Quant Analyst
- [ ] Configure primary provider/model
- [ ] Configure fallback provider/model
- [ ] Configure temperature
- [ ] Default temperature 0.2
- [ ] Configure max output tokens
- [ ] Default Analyst max output = 1500
- [ ] Configure timeout
- [ ] Run 6 Analyst parallel
- [ ] Pastikan Analyst tidak melihat output Analyst lain
- [ ] Parse BUY/SELL/NO_TRADE
- [ ] Parse individual confidence
- [ ] Parse summary
- [ ] Parse reasoning
- [ ] Parse evidence
- [ ] Parse risk flags

---

# Milestone 14 — Semantic Validator

- [ ] Validate JSON/schema
- [ ] Validate vote field
- [ ] Validate direction/reason consistency
- [ ] Validate bias consistency
- [ ] Validate evidence shape
- [ ] Validate price direction consistency
- [ ] Flag `SEMANTIC_VALIDATION_FAILED`
- [ ] Retry jika validation gagal
- [ ] Jika persistent invalid → gunakan vote response terakhir
- [ ] First failure severity kuning
- [ ] Persistent failure severity merah
- [ ] Public hanya melihat generic warning
- [ ] Admin melihat detail

---

# Milestone 15 — AI Voting Engine

- [ ] Implement 1 Analyst = 1 vote
- [ ] Implement BUY count
- [ ] Implement SELL count
- [ ] Implement NO_TRADE abstain
- [ ] Implement UNAVAILABLE
- [ ] Minimum normal success = 3/6
- [ ] <3 success → `AI_DEGRADED`
- [ ] Implement AI majority
- [ ] Implement AI tie
- [ ] Implement all-NO_TRADE fallback ke scanner
- [ ] Implement scanner fallback
- [ ] Implement NO_CONSENSUS
- [ ] Persist vote composition

---

# Milestone 16 — Deterministic Risk Engine

- [ ] Implement M15-dominant level selection
- [ ] H1 sebagai major bias/structure context
- [ ] M5 sebagai refinement
- [ ] Implement Entry Zone structure-based
- [ ] Tambahkan ATR buffer
- [ ] Hitung `entry_low`
- [ ] Hitung `entry_high`
- [ ] Hitung Preferred Entry midpoint
- [ ] Implement structural Stop Loss
- [ ] Tambahkan ATR SL buffer
- [ ] Implement structure/SR/liquidity Take Profit
- [ ] Hanya 1 TP
- [ ] Hanya 1 SL
- [ ] Hitung R:R dari Preferred Entry
- [ ] Implement configurable minimum R:R
- [ ] Default minimum R:R 1:1.5
- [ ] Implement LOW_RR
- [ ] LOW_RR tidak mengurangi confidence
- [ ] Persist risk calculation snapshot

---

# Milestone 17 — AI Risk Manager

- [ ] Buat Risk Manager role prompt
- [ ] Jalankan setelah Analyst terminal state
- [ ] Berikan scanner context
- [ ] Berikan AI voting
- [ ] Berikan deterministic risk proposal
- [ ] Default max output tokens = 2000
- [ ] Validate structured output
- [ ] Jika gagal → gunakan deterministic Risk Engine
- [ ] Persist Risk Manager output
- [ ] Persist fallback metadata

---

# Milestone 18 — Boss / Head Trader

- [ ] Buat Boss role prompt
- [ ] Berikan full scanner context
- [ ] Berikan seluruh Analyst summaries
- [ ] Berikan vote composition
- [ ] Berikan Risk Engine
- [ ] Berikan Risk Manager
- [ ] Berikan H1/M15/M5 context
- [ ] Default max output tokens = 2000
- [ ] Implement majority BUY → BUY/NO_TRADE only
- [ ] Implement majority SELL → SELL/NO_TRADE only
- [ ] Larang reverse majority normal
- [ ] Boss NO_TRADE normal → fallback majority AI
- [ ] Boss tie-breaker → BUY/SELL/NO_TRADE
- [ ] Boss NO_TRADE saat tie → scanner fallback
- [ ] No scanner majority → NO_CONSENSUS
- [ ] Persist Boss decision

---

# Milestone 19 — Final Confidence Engine

- [ ] Implement configurable Scanner weight
- [ ] Default Scanner = 30%
- [ ] Implement configurable AI weight
- [ ] Default AI = 40%
- [ ] Implement configurable MTF weight
- [ ] Default MTF = 30%
- [ ] Validate total = 100%
- [ ] Scanner Consensus = aligned scanners / 6
- [ ] AI Consensus = aligned AI votes / 6
- [ ] NO_TRADE tetap denominator
- [ ] UNAVAILABLE tetap denominator
- [ ] Implement H1 weight 30%
- [ ] Implement M15 weight 45%
- [ ] Implement M5 weight 25%
- [ ] Validate MTF weights total 100%
- [ ] Aligned = 100
- [ ] Neutral default = 50
- [ ] Opposing = 0
- [ ] Neutral score configurable
- [ ] Counter-trend menurunkan MTF score
- [ ] Round UI output ke integer
- [ ] Simpan precision value backend
- [ ] LOW_RR tidak memengaruhi confidence

---

# Milestone 20 — Signal Engine

- [ ] Buat internal signal UUID
- [ ] Buat human Signal ID
- [ ] Format `SIG-YYYYMMDD-XXXX`
- [ ] Reset sequence 00:00 WIB
- [ ] Jangan reuse nomor
- [ ] Persist direction
- [ ] Persist Entry Zone
- [ ] Persist Preferred Entry
- [ ] Persist SL
- [ ] Persist TP
- [ ] Persist R:R
- [ ] Persist Final Confidence
- [ ] Persist MTF context
- [ ] Persist scanner composition
- [ ] Persist AI composition
- [ ] Persist flags
- [ ] Persist config version
- [ ] Persist Case ID
- [ ] Implement LOW_RR flag
- [ ] Implement COUNTER_TREND flag
- [ ] Implement AI_DEGRADED flag
- [ ] Implement SCANNER_FALLBACK flag
- [ ] Implement MANUAL/EMERGENCY flags
- [ ] Cegah duplicate signal

---

# Milestone 21 — Discord

- [ ] Configure Meeting Webhook
- [ ] Configure Signal Webhook
- [ ] Buat `AI OFFICE MEETING STARTED`
- [ ] Tampilkan scanner composition
- [ ] Tampilkan BTCUSDT price
- [ ] Tampilkan timestamp WIB
- [ ] Tampilkan Case ID
- [ ] Tampilkan View Live Case link
- [ ] Buat Final Signal message
- [ ] Tampilkan Entry Zone
- [ ] Tampilkan Preferred Entry
- [ ] Tampilkan TP
- [ ] Tampilkan SL
- [ ] Tampilkan R:R
- [ ] Tampilkan Confidence
- [ ] Tampilkan AI vote
- [ ] Tampilkan Boss outcome
- [ ] Tampilkan Signal ID
- [ ] Tampilkan LOW_RR warning
- [ ] Implement `Notify No Consensus`
- [ ] Default Notify No Consensus OFF
- [ ] Cegah duplicate Discord delivery
- [ ] Persist Discord delivery result

---

# Milestone 22 — Public API

- [ ] Setup `/api/v1`
- [ ] `GET /api/v1/market/status`
- [ ] `GET /api/v1/scanners`
- [ ] `GET /api/v1/office/state`
- [ ] `GET /api/v1/signals`
- [ ] `GET /api/v1/signals/:id`
- [ ] `GET /api/v1/cases/:id/public`
- [ ] Pagination signals
- [ ] Public Signals ON/OFF enforcement
- [ ] Public Signal History ON/OFF enforcement
- [ ] Public history limit setting
- [ ] Redact Admin-only fields
- [ ] Implement API rate limiting jika diperlukan

---

# Milestone 23 — Admin API

- [ ] Provider settings endpoints
- [ ] Character settings endpoints
- [ ] Prompt settings endpoints
- [ ] Scanner settings endpoints
- [ ] Risk settings endpoints
- [ ] Confidence settings endpoints
- [ ] Trading Config endpoints
- [ ] Discord settings endpoints
- [ ] Simulation endpoints
- [ ] Emergency Meeting endpoints
- [ ] Provider health endpoints
- [ ] Usage endpoints
- [ ] Apply config endpoints
- [ ] Rollback prompt endpoints

---

# Milestone 24 — 2D Operational UI

## Global

- [ ] Mobile-first navigation
- [ ] Dark premium BYGA design
- [ ] Responsive portrait
- [ ] Responsive landscape
- [ ] Loading states
- [ ] Empty states
- [ ] Error states
- [ ] Offline/retry state

## Office HUD

- [ ] BTCUSDT price
- [ ] office state
- [ ] scanner statuses
- [ ] next scan
- [ ] case status
- [ ] signal status
- [ ] navigation

## Signals

- [ ] Signals list
- [ ] Signal detail
- [ ] BUY/SELL filter
- [ ] Date filter
- [ ] Case ID filter
- [ ] Signal ID filter
- [ ] Confidence range filter
- [ ] LOW_RR filter
- [ ] COUNTER_TREND filter
- [ ] AI_DEGRADED filter
- [ ] Scanner trigger filter
- [ ] AUTO/MANUAL filter
- [ ] Pagination

## Cases

- [ ] Cases list
- [ ] Case detail
- [ ] Timeline
- [ ] Scanner snapshot
- [ ] Analyst results
- [ ] Voting
- [ ] Risk
- [ ] Boss
- [ ] Config version
- [ ] Provider/model metadata Admin-only

## Scanners

- [ ] Scanner Command Center
- [ ] Trend detail page
- [ ] Breakout detail page
- [ ] Momentum detail page
- [ ] Mean Reversion detail page
- [ ] Structure detail page
- [ ] Liquidity detail page

## Characters

- [ ] Characters page
- [ ] Character detail page
- [ ] Current state
- [ ] Latest vote
- [ ] Confidence
- [ ] Provider/model Admin-only
- [ ] Warning state
- [ ] History

## Admin

- [ ] Settings page
- [ ] Provider page
- [ ] Character config
- [ ] Prompt config
- [ ] Trading Config version UI
- [ ] Risk config
- [ ] Confidence config
- [ ] MTF config
- [ ] Discord config
- [ ] Provider health
- [ ] Usage summary

---

# Milestone 25 — Public Signal UI

- [ ] Implement `Public Signals` setting
- [ ] Public signal detail
- [ ] Public signal history
- [ ] Summary reasoning
- [ ] Scanner composition
- [ ] AI vote composition
- [ ] H1/M15/M5
- [ ] LOW_RR warning
- [ ] COUNTER_TREND warning
- [ ] Generic semantic quality warning
- [ ] Jangan tampilkan provider debug
- [ ] Jangan tampilkan full prompt
- [ ] Jangan tampilkan raw AI response
- [ ] Jangan tampilkan secrets

---

# Milestone 26 — Realtime Office State

- [ ] Buat office state endpoint
- [ ] Implement SSE jika stabil
- [ ] Implement polling fallback
- [ ] State MONITORING
- [ ] State WATCHING
- [ ] State TRIGGERED
- [ ] State AI_ANALYSIS
- [ ] State RISK_REVIEW
- [ ] State BOSS_DECISION
- [ ] State DISCORD
- [ ] State RETURN_TO_DESK
- [ ] Reconnect handling
- [ ] Jangan jadikan browser source of truth

---

# Milestone 27 — 3D Office Base

- [ ] Setup React Three Fiber
- [ ] Setup scene
- [ ] Setup camera isometric
- [ ] Limited rotation
- [ ] Pan
- [ ] Zoom
- [ ] Reset View
- [ ] Mobile pinch zoom
- [ ] Mobile drag pan
- [ ] Mobile two-finger rotate
- [ ] Setup lighting
- [ ] Setup luxury modern materials
- [ ] Setup BYGA/BG branding

---

# Milestone 28 — 3D Office Rooms

- [ ] BYGA Lobby
- [ ] Analyst Floor
- [ ] Scanner Command Center
- [ ] Market Wall
- [ ] Risk Office
- [ ] War Room / Meeting Room
- [ ] Boss Office
- [ ] Server/Data Room
- [ ] Lounge / Pantry
- [ ] Hallway / walking paths
- [ ] Musolla

---

# Milestone 29 — 3D Characters

- [ ] Model/preset Trend Analyst
- [ ] Model/preset Structure Analyst
- [ ] Model/preset Momentum Analyst
- [ ] Model/preset Liquidity Analyst
- [ ] Model/preset Volume Analyst
- [ ] Model/preset Quant Analyst
- [ ] Model/preset Risk Manager
- [ ] Model/preset Boss
- [ ] Character customization config
- [ ] Idle animation
- [ ] Typing animation
- [ ] Monitor animation
- [ ] Walking animation
- [ ] Meeting animation
- [ ] Boss notification/phone animation
- [ ] Return-to-desk animation

---

# Milestone 30 — Character Navigation

- [ ] Buat waypoint graph
- [ ] Desk → War Room path
- [ ] Desk → Lounge path
- [ ] Desk → Musolla path
- [ ] Risk Office routes
- [ ] Boss Office routes
- [ ] Prevent obvious collision
- [ ] Character walk instead of teleport
- [ ] Implement safe teleport fallback only jika path gagal

---

# Milestone 31 — Living Office

- [ ] MONITORING animation
- [ ] WATCHING animation
- [ ] TRIGGERED animation
- [ ] AI_ANALYSIS animation
- [ ] RISK_REVIEW animation
- [ ] BOSS_DECISION animation
- [ ] DISCORD animation
- [ ] RETURN_TO_DESK animation
- [ ] Idle desk activity
- [ ] Coffee/lounge activity
- [ ] Relevant Analyst react pada WATCHING
- [ ] Decorative behavior tidak memanggil AI

---

# Milestone 32 — Character Interaction UI

- [ ] Click/tap character
- [ ] Speech bubble
- [ ] Name
- [ ] Role
- [ ] Current status
- [ ] Short live summary
- [ ] `Lihat Detail`
- [ ] Public summary view
- [ ] Admin expanded view

---

# Milestone 33 — Market Wall

- [ ] Lightweight decorative chart in 3D
- [ ] Click/tap interaction
- [ ] Open real chart panel
- [ ] H1
- [ ] M15
- [ ] M5
- [ ] Data dari `chart_db`
- [ ] Responsive chart panel
- [ ] WIB timestamps

---

# Milestone 34 — Server/Data Room

- [ ] chart_db health
- [ ] Trading Office API health
- [ ] AI Providers aggregate health
- [ ] Discord health
- [ ] OK / DEGRADED / DOWN visual
- [ ] Admin provider detail
- [ ] Circuit breaker detail Admin-only

---

# Milestone 35 — Musolla

- [ ] Buat tombol `Sholat`
- [ ] Manual trigger only
- [ ] Available characters berjalan ke Musolla
- [ ] Trading workflow priority
- [ ] Queue Sholat request jika case aktif
- [ ] Return characters setelah sequence selesai
- [ ] Pastikan tidak mengubah trading state/data

---

# Milestone 36 — Adaptive 3D Quality

- [ ] Detect performance capability
- [ ] Low/medium/high quality profile
- [ ] Reduce shadows pada low-end
- [ ] Reduce texture resolution
- [ ] Reduce anti-aliasing
- [ ] Reduce decorative animation
- [ ] Reduce particles
- [ ] Implement LOD
- [ ] Implement instancing untuk repetitive props
- [ ] Lazy-load noncritical assets
- [ ] Compress textures
- [ ] Draco/Meshopt jika sesuai

---

# Milestone 37 — WebGL Fallback

- [ ] Detect WebGL failure
- [ ] Tampilkan 2D Operations Dashboard
- [ ] Scanner tetap usable
- [ ] Signal tetap usable
- [ ] Admin tetap usable
- [ ] Trading backend tetap berjalan tanpa WebGL

---

# Milestone 38 — Emergency Meeting

- [ ] Admin button `CALL EMERGENCY MEETING`
- [ ] Neutral Analysis mode
- [ ] Investigate BUY mode
- [ ] Investigate SELL mode
- [ ] Gunakan latest closed H1/M15/M5
- [ ] Tetap jalankan 6 scanner
- [ ] Bypass normal scanner trigger
- [ ] AI bebas voting
- [ ] AI majority sebagai arah jika scanner tidak majority
- [ ] Boss tie-breaker
- [ ] Boss NO_TRADE → scanner fallback
- [ ] No scanner majority → NO_CONSENSUS
- [ ] Badge MANUAL / EMERGENCY
- [ ] Masuk Live Signals
- [ ] `Send to Discord` toggle
- [ ] Default toggle OFF

---

# Milestone 39 — Simulation

- [ ] Historical candle selector
- [ ] Historical snapshot loader
- [ ] Run 6 scanners
- [ ] Run 6 AI Analysts
- [ ] Run voting
- [ ] Run Risk Engine
- [ ] Run Risk Manager
- [ ] Run Boss
- [ ] Generate simulated final result
- [ ] Isolate from Live Signals
- [ ] Store di `/simulation/history`
- [ ] Discord default OFF
- [ ] Playback 1x
- [ ] Playback 2x
- [ ] Playback 4x
- [ ] Skip to Result
- [ ] CURRENT CONFIG mode
- [ ] HISTORICAL CONFIG mode
- [ ] STRICT REPLAY
- [ ] COMPATIBLE REPLAY
- [ ] Persist replay mode
- [ ] Handle unavailable historical model clearly

---

# Milestone 40 — AI Usage & Budget Controls

- [ ] Max AI cases/day
- [ ] Max estimated tokens/case
- [ ] Max calls/case
- [ ] Case cooldown
- [ ] Emergency limit
- [ ] Simulation limit
- [ ] Default unlimited/OFF
- [ ] Track calls today
- [ ] Track estimated tokens today
- [ ] Reset 00:00 WIB
- [ ] Usage display Admin

---

# Milestone 41 — Retention

- [ ] Structured AI output permanent
- [ ] Case summary permanent
- [ ] Signal permanent
- [ ] Scanner snapshot permanent
- [ ] Config versions permanent
- [ ] Prompt versions permanent
- [ ] Risk result permanent
- [ ] Boss result permanent
- [ ] Raw provider response retention
- [ ] Rendered prompt retention
- [ ] Default retention 90 hari
- [ ] Retention configurable
- [ ] Scheduled cleanup
- [ ] Redact secrets sebelum storage

---

# Milestone 42 — Security Hardening

- [ ] Audit client bundle untuk secrets
- [ ] Audit API authorization
- [ ] Validate all Admin input
- [ ] Sanitize provider response
- [ ] Escape rendered content
- [ ] Protect mutation endpoints
- [ ] CSRF-safe strategy
- [ ] Login rate limiting
- [ ] API rate limiting
- [ ] Secure cookie review
- [ ] Restrict chart_db writes
- [ ] Restrict raw AI logs ke Admin
- [ ] Restrict prompt logs ke Admin
- [ ] Restrict circuit breaker state ke Admin
- [ ] Test session expiration
- [ ] Test unauthorized access

---

# Milestone 43 — Reliability & Idempotency

- [ ] Duplicate M5 candle test
- [ ] Duplicate case creation test
- [ ] Duplicate signal creation test
- [ ] Duplicate Discord delivery test
- [ ] Retry-safe endpoints
- [ ] Worker restart recovery
- [ ] Queue recovery
- [ ] Active case recovery
- [ ] Provider timeout recovery
- [ ] Provider fallback recovery
- [ ] D1 temporary failure handling
- [ ] Discord failure handling

---

# Milestone 44 — Testing

## Unit

- [ ] Indicators
- [ ] Structure detection
- [ ] Scanner rules
- [ ] Trigger engine
- [ ] MTF scoring
- [ ] Confidence formula
- [ ] Risk calculations
- [ ] R:R calculation
- [ ] ID generation
- [ ] Semantic validator
- [ ] Voting
- [ ] Circuit breaker

## Integration

- [ ] chart_db → scanner
- [ ] scanner → case
- [ ] case → AI
- [ ] AI → voting
- [ ] voting → risk
- [ ] risk → Boss
- [ ] Boss → signal
- [ ] signal → Discord
- [ ] Simulation flow
- [ ] Emergency flow

## E2E

- [ ] Normal BUY flow
- [ ] Normal SELL flow
- [ ] Scanner tie
- [ ] AI tie
- [ ] All AI NO_TRADE
- [ ] AI_DEGRADED
- [ ] Provider primary failure
- [ ] Fallback success
- [ ] Primary + fallback failure
- [ ] Semantic validation failure
- [ ] LOW_RR
- [ ] COUNTER_TREND
- [ ] Queue stale
- [ ] Direction changed
- [ ] Config changed
- [ ] NO_CONSENSUS
- [ ] Public Signals ON
- [ ] Public Signals OFF

---

# Milestone 45 — Mobile QA

- [ ] Android portrait
- [ ] Android landscape
- [ ] Small screen
- [ ] Mid-range device
- [ ] Low-end device
- [ ] Touch gestures
- [ ] Bottom sheets
- [ ] 3D frame rate
- [ ] Character tap target
- [ ] Market Wall tap
- [ ] Scanner panels
- [ ] Signal detail
- [ ] Admin forms

---

# Milestone 46 — Performance Optimization

- [ ] Measure initial bundle
- [ ] Code split 3D
- [ ] Lazy-load Admin
- [ ] Lazy-load Simulation
- [ ] Optimize GLB/GLTF
- [ ] Optimize textures
- [ ] Optimize D1 queries
- [ ] Add indexes
- [ ] Paginate histories
- [ ] Avoid unnecessary provider calls
- [ ] Cache model lists
- [ ] Cache safe static configuration
- [ ] Measure mobile FPS
- [ ] Measure API latency

---

# Milestone 47 — Production Readiness

- [ ] Production Wrangler config
- [ ] Production D1 migrations
- [ ] Production R2 assets
- [ ] Production secrets
- [ ] Production Admin password
- [ ] Production Discord webhooks
- [ ] Verify chart_db binding
- [ ] Verify read-only behavior
- [ ] Verify AI provider connectivity
- [ ] Verify model discovery
- [ ] Verify fallback provider
- [ ] Verify circuit breaker
- [ ] Verify Public Signals setting
- [ ] Verify retention
- [ ] Verify error pages
- [ ] Verify WebGL fallback
- [ ] Run smoke test
- [ ] Run security checklist
- [ ] Run final mobile QA

---

# MVP Definition of Done

MVP selesai jika seluruh berikut terpenuhi:

- [ ] BTCUSDT H1/M15/M5 dibaca aman dari `chart_db`
- [ ] 6 scanner deterministic aktif
- [ ] Closed M5 trigger bekerja tanpa duplicate
- [ ] Queue + revalidation bekerja
- [ ] 6 AI Analyst parallel bekerja
- [ ] 8 provider adapter tersedia
- [ ] Primary/fallback provider bekerja
- [ ] Retry/backoff/jitter bekerja
- [ ] Circuit breaker bekerja
- [ ] Voting BUY/SELL/NO_TRADE bekerja
- [ ] AI_DEGRADED fallback bekerja
- [ ] Risk Engine menghasilkan Entry/SL/TP/R:R
- [ ] Risk Manager bekerja
- [ ] Boss rules bekerja
- [ ] Final Confidence deterministic bekerja
- [ ] Signal tersimpan dengan snapshot/config version
- [ ] Discord meeting + signal notification bekerja
- [ ] Emergency Meeting bekerja
- [ ] Simulation terpisah dari Live
- [ ] Public/Admin permissions bekerja
- [ ] 3D Office merepresentasikan backend state
- [ ] Mobile portrait/landscape usable
- [ ] WebGL fallback tersedia
- [ ] Secret tidak terekspos ke client
- [ ] Production smoke test lulus

---

# Recommended Execution Order

1. [ ] Milestone 0–4: Foundation
2. [ ] Milestone 5–7: Indicators, scanners, trigger
3. [ ] Milestone 8: Case queue/orchestrator
4. [ ] Milestone 9–14: AI provider + analysts
5. [ ] Milestone 15–20: Voting, risk, Boss, signal
6. [ ] Milestone 21: Discord
7. [ ] Milestone 22–25: API + 2D UI
8. [ ] Milestone 26–37: Realtime + 3D Office
9. [ ] Milestone 38–39: Emergency + Simulation
10. [ ] Milestone 40–47: Usage, retention, testing, security, production
