# CHECKLIST — BYGA AI Trading Office

Checklist implementasi MVP berdasarkan PRD v1.0.

Legend:
- [ ] Belum
- [x] Selesai
- [~] Sedang dikerjakan


## Update build lanjutan — 4 Oktober 2026 (UTC)

Reader mendukung `closed: "is_closed"` dan hanya SELECT; validator AI memeriksa hubungan entry/SL/TP; API memiliki rate limit persisten pada database aplikasi; metadata provider/model ditampilkan khusus Admin; modul Admin dan Simulation dimuat terpisah. Typecheck, lint, build, dan 66 unit test lulus. Suite saat ini memiliki 100 tes total; 34 tes integrasi belum berjalan karena sandbox menolak server lokal (`listen EPERM`). Tiga skenario browser baru ditambahkan (30 eksekusi lintas tiga viewport); suite browser baru belum dijalankan. Validasi sebelumnya di bawah adalah catatan historis. Tidak ada migrasi/deployment remote.

## Update implementasi awal — 4 Oktober 2026 (WIB)

Fondasi dan pipeline backend diimplementasikan serta diuji lokal; UI/3D masih tahap awal. Pembaruan lanjutan: recovery D1 terbatas, resume keluaran AI, retensi idle, review audit Discord, filter scanner, reconnect offline, routing meja/dinding, instancing dan kualitas adaptif sudah ditambahkan. QA browser tetap terpisah dari acceptance produksi/perangkat fisik. `[x]` menunjukkan implementasi dengan pemeriksaan lokal relevan, `[~]` menunjukkan implementasi awal atau validasi lanjutan yang masih diperlukan. Bukan klaim MVP produksi selesai.

Validasi: TypeScript, lint, build, 84 unit/integration tests dengan fixture AI/Discord, empat migration lokal dan Worker dry-run. QA browser dijalankan dengan Chromium sistem: 21 skenario pada desktop, portrait dan landscape (API fixture; bukan QA perangkat fisik). Binding `chart_db` produksi, API key, password Admin pengguna, webhook, R2 dan deployment produksi belum tersedia.

Rincian dan batasan: [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md). Repository existing `byga_office` dipertahankan; package internal bernama `byga-trading-office`.

---

Account dan kedua database telah diperiksa melalui GET/SELECT konektor Cloudflare; schema remote tercatat di docs/CLOUDFLARE_VERIFICATION.md. Token environment masih belum terverifikasi melalui API; belum ada migrasi atau deployment remote.

# Milestone 0 — Repository & Project Setup

- [~] Buat/siapkan repository `byga-trading-office`
- [x] Tentukan package manager
- [x] Setup React frontend
- [x] Setup Cloudflare Workers backend
- [x] Setup TypeScript
- [x] Setup linting
- [x] Setup formatting
- [~] Setup environment separation dev/staging/prod
- [x] Setup Wrangler configuration
- [x] Setup CI build
- [~] Setup basic deployment pipeline
- [x] Buat `.env.example` tanpa secret nyata
- [x] Dokumentasikan local development

---

# Milestone 1 — Cloudflare Foundation

## D1

- [~] Bind existing `chart_db`
- [x] Pastikan `chart_db` digunakan read-only
- [~] Buat `trading_office_db`
- [x] Buat migration system
- [x] Buat tabel `cases`
- [x] Buat tabel `signals`
- [x] Buat tabel `scanner_runs`
- [x] Buat tabel `scanner_outputs`
- [x] Buat tabel `ai_runs`
- [x] Buat tabel `ai_character_outputs`
- [x] Buat tabel `risk_runs`
- [x] Buat tabel `boss_decisions`
- [x] Buat tabel `trading_config_versions`
- [x] Buat tabel `prompt_versions`
- [x] Buat tabel `character_configs`
- [x] Buat tabel `provider_configs`
- [x] Buat tabel `simulation_runs`
- [x] Buat tabel `discord_deliveries`
- [x] Buat tabel `usage_daily`
- [x] Buat tabel `system_state`

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
- [x] Pastikan secret tidak terekspos ke client

---

# Milestone 2 — Admin Authentication

- [~] Buat halaman login Admin
- [x] Implement password hashing
- [x] Implement secure session
- [x] Gunakan HttpOnly cookie
- [x] Gunakan Secure cookie
- [x] Gunakan SameSite cookie
- [x] Implement session expiry
- [x] Implement logout
- [x] Implement login rate limiting
- [x] Proteksi semua Admin API
- [x] Pastikan public route tidak bocorkan config sensitif
- [x] Tambahkan middleware authorization

---

# Milestone 3 — Market Data Layer

- [x] Buat read-only repository untuk `chart_db`
- [x] Implement query candle BTCUSDT H1
- [x] Implement query candle BTCUSDT M15
- [x] Implement query candle BTCUSDT M5
- [x] Pastikan hanya closed candle digunakan
- [x] Implement timestamp normalization UTC
- [x] Implement display conversion WIB
- [x] Implement dynamic price precision
- [x] Implement latest candle query
- [x] Implement historical snapshot query
- [x] Implement data validation
- [x] Implement missing candle handling
- [x] Buat `/api/v1/market/status`
- [x] Test bahwa Trading Office tidak pernah menulis ke `chart_db`

---

# Milestone 4 — Trading Configuration Versioning

- [x] Definisikan Trading Config schema
- [x] Buat default `TRADING-CONFIG-v1`
- [x] Implement immutable config snapshot
- [x] Implement version increment
- [x] Simpan scanner params
- [x] Simpan ATR params
- [x] Simpan Entry Zone params
- [x] Simpan SL params
- [x] Simpan TP params
- [x] Simpan minimum R:R
- [x] Simpan confidence weights
- [x] Simpan MTF weights
- [x] Simpan NEUTRAL score
- [x] Simpan cooldown settings
- [x] Simpan AI candle context settings
- [x] Implement `NEXT CASE`
- [x] Implement `APPLY NOW`
- [~] Implement confirmation dialog untuk APPLY NOW
- [x] Implement cancel active case sebagai `CONFIG_CHANGED`
- [x] Implement restart sebagai Case ID baru

---

# Milestone 5 — Indicator & Structure Engine

- [x] Implement EMA 20
- [x] Implement EMA 50
- [x] Implement EMA 200
- [x] Implement ADX
- [x] Implement RSI
- [x] Implement MACD
- [x] Implement ROC
- [x] Implement Bollinger Bands
- [x] Implement ATR
- [x] Implement volume metrics
- [x] Implement swing high/low detection
- [~] Implement HH/HL
- [~] Implement LH/LL
- [~] Implement BOS
- [~] Implement CHoCH
- [x] Implement support/resistance detection
- [x] Implement liquidity high/low
- [x] Implement liquidity sweep detection
- [~] Implement FVG detection
- [~] Implement order-block approximation
- [x] Implement breakout detection
- [x] Implement retest detection
- [x] Tambahkan unit test indicator
- [x] Tambahkan unit test structure detection

---

# Milestone 6 — Six Deterministic Scanners

## Trend Scanner

- [~] Implement H1 bias
- [~] Implement M15 setup
- [~] Implement M5 trigger
- [~] Implement BUY rule
- [~] Implement SELL rule
- [~] Implement NONE rule
- [~] Implement reasons[]
- [~] Implement levels[]
- [~] Implement strength informational
- [~] Simpan indicator snapshot

## Breakout & Retest Scanner

- [~] Implement breakout detection
- [~] Implement retest validation
- [~] Implement S/R context
- [~] Implement ATR context
- [~] Implement volume confirmation
- [~] Implement BUY/SELL/NONE
- [~] Implement reasons[]
- [~] Simpan indicator snapshot

## Momentum Scanner

- [~] Implement RSI logic
- [~] Implement MACD logic
- [~] Implement ROC logic
- [~] Implement candle momentum
- [~] Implement volume momentum
- [~] Implement BUY/SELL/NONE
- [~] Implement reasons[]
- [~] Simpan indicator snapshot

## Mean Reversion Scanner

- [~] Implement Bollinger logic
- [~] Implement RSI overextension
- [~] Implement deviation metric
- [~] Implement mean reversion rules
- [~] Implement BUY/SELL/NONE
- [~] Implement reasons[]
- [~] Simpan indicator snapshot

## Market Structure Scanner

- [~] Implement HH/HL state
- [~] Implement LH/LL state
- [~] Implement BOS
- [~] Implement CHoCH
- [~] Implement structural bias
- [~] Implement BUY/SELL/NONE
- [~] Implement reasons[]
- [~] Simpan structure snapshot

## Liquidity / SMC Scanner

- [~] Implement liquidity levels
- [~] Implement sweep detection
- [~] Implement FVG
- [~] Implement order-block approximation
- [~] Implement displacement logic
- [~] Implement BUY/SELL/NONE
- [~] Implement reasons[]
- [~] Simpan structure snapshot

## Scanner Common

- [x] Buat common scanner interface
- [x] Validasi structured output
- [x] Simpan config version
- [x] Simpan candle timestamp
- [x] Simpan reasons untuk NONE
- [x] Buat scanner history query
- [x] Buat scanner unit tests

---

# Milestone 7 — M5 Scheduler & Trigger Engine

- [x] Detect closed M5 candle
- [x] Tambahkan short processing delay
- [x] Implement `last_processed_candle`
- [x] Cegah duplicate scan
- [x] Run semua 6 scanner
- [x] Hitung BUY count
- [x] Hitung SELL count
- [x] Hitung NONE count
- [x] Require minimum 2 same-direction scanner
- [x] Require unique directional majority
- [x] Tie → no trigger
- [x] Implement WATCHING state
- [x] Implement TRIGGERED state
- [x] Implement directional cooldown
- [x] Default cooldown 15 menit
- [x] BUY/SELL cooldown terpisah
- [x] Implement `FROM_TRIGGER`
- [x] Implement `FROM_FINAL_DECISION`
- [x] Default `FROM_TRIGGER`

---

# Milestone 8 — Case Engine & Queue

- [x] Buat internal UUID
- [x] Buat human Case ID
- [x] Format `CASE-YYYYMMDD-XXXX`
- [x] Reset sequence setiap 00:00 WIB
- [x] Jangan reuse nomor
- [x] Implement single active live case
- [x] Implement pending queue
- [x] Persist queue state
- [x] Implement queue revalidation
- [x] Re-run scanners sebelum queued case diproses
- [x] Invalid setup → `STALE/CANCELLED`
- [x] Direction berubah → `DIRECTION_CHANGED`
- [x] Buat Case ID baru untuk arah baru
- [x] Implement `AI_DEGRADED`
- [x] Implement `NO_CONSENSUS`
- [x] Implement `CONFIG_CHANGED`
- [~] Implement failure recovery
- [x] Implement idempotency key
- [x] Test duplicate request handling

---

# Milestone 9 — AI Provider Abstraction

- [x] Buat common AI provider interface
- [x] Implement OpenAI adapter
- [x] Implement Gemini adapter
- [x] Implement Groq adapter
- [x] Implement OpenRouter adapter
- [x] Implement Mistral adapter
- [x] Implement Hugging Face adapter
- [x] Implement Cohere adapter
- [x] Implement NVIDIA adapter
- [~] Implement dynamic model discovery
- [~] Implement Custom Model ID
- [x] Implement provider-specific error normalization
- [x] Implement token usage extraction jika tersedia
- [~] Implement structured output capability detection
- [x] Implement fallback JSON parser
- [x] Implement timeout
- [x] Implement configurable retry
- [x] Default primary retry = 1
- [x] Default fallback retry = 1
- [x] Implement exponential backoff
- [x] Implement jitter
- [x] Implement fallback provider/model
- [x] Implement `MODEL_FALLBACK_USED`
- [~] Implement provider health state
- [~] Implement manual Test Connection

---

# Milestone 10 — Circuit Breaker

- [x] Implement per-provider circuit breaker
- [x] Default threshold 3 consecutive failures
- [x] Default cooldown 5 menit
- [x] Implement CLOSED
- [x] Implement OPEN
- [x] Implement HALF_OPEN
- [x] OPEN → skip primary
- [x] OPEN → langsung fallback
- [~] HALF_OPEN test flow
- [x] Success → CLOSED
- [x] Failure → OPEN
- [x] Expose detail Admin-only

---

# Milestone 11 — Prompt System

- [x] Buat locked Core Role Prompt per karakter
- [~] Buat Custom Instructions editable
- [~] Buat Personality editable
- [x] Buat locked output schema
- [x] Implement prompt rendering
- [x] Implement prompt versioning
- [x] Implement rollback prompt version
- [x] Simpan `prompt_version`
- [x] Simpan structured input snapshot
- [x] Simpan rendered prompt dengan retention
- [x] Redact secrets
- [x] Buat default prompt 8 karakter

---

# Milestone 12 — AI Context Builder

- [x] Default H1 = 50 candle
- [x] Default M15 = 100 candle
- [x] Default M5 = 100 candle
- [x] Jadikan jumlah candle configurable
- [x] Build scanner context
- [x] Build indicator context
- [x] Build MTF context
- [x] Implement smart context compression
- [x] Prioritaskan candle terbaru
- [x] Summarize candle lama
- [x] Implement safe truncate
- [x] Simpan `context_compressed`

---

# Milestone 13 — Six AI Analysts

- [x] Buat Trend Analyst
- [x] Buat Structure Analyst
- [x] Buat Momentum Analyst
- [x] Buat Liquidity Analyst
- [x] Buat Volume Analyst
- [x] Buat Quant Analyst
- [x] Configure primary provider/model
- [x] Configure fallback provider/model
- [x] Configure temperature
- [x] Default temperature 0.2
- [x] Configure max output tokens
- [x] Default Analyst max output = 1500
- [x] Configure timeout
- [x] Run 6 Analyst parallel
- [x] Pastikan Analyst tidak melihat output Analyst lain
- [x] Parse BUY/SELL/NO_TRADE
- [x] Parse individual confidence
- [x] Parse summary
- [x] Parse reasoning
- [x] Parse evidence
- [x] Parse risk flags

---

# Milestone 14 — Semantic Validator

- [x] Validate JSON/schema
- [x] Validate vote field
- [~] Validate direction/reason consistency
- [x] Validate bias consistency
- [x] Validate evidence shape
- [x] Validate price direction consistency (entry/SL/TP terstruktur; unit/provider fixture lulus)
- [x] Flag `SEMANTIC_VALIDATION_FAILED`
- [x] Retry jika validation gagal
- [x] Jika persistent invalid → gunakan vote response terakhir
- [x] First failure severity kuning
- [x] Persistent failure severity merah
- [x] Public hanya melihat generic warning
- [x] Admin melihat detail

---

# Milestone 15 — AI Voting Engine

- [x] Implement 1 Analyst = 1 vote
- [x] Implement BUY count
- [x] Implement SELL count
- [x] Implement NO_TRADE abstain
- [x] Implement UNAVAILABLE
- [x] Minimum normal success = 3/6
- [x] <3 success → `AI_DEGRADED`
- [x] Implement AI majority
- [x] Implement AI tie
- [x] Implement all-NO_TRADE fallback ke scanner
- [x] Implement scanner fallback
- [x] Implement NO_CONSENSUS
- [x] Persist vote composition

---

# Milestone 16 — Deterministic Risk Engine

- [x] Implement M15-dominant level selection
- [x] H1 sebagai major bias/structure context
- [~] M5 sebagai refinement
- [x] Implement Entry Zone structure-based
- [x] Tambahkan ATR buffer
- [x] Hitung `entry_low`
- [x] Hitung `entry_high`
- [x] Hitung Preferred Entry midpoint
- [x] Implement structural Stop Loss
- [x] Tambahkan ATR SL buffer
- [x] Implement structure/SR/liquidity Take Profit
- [x] Hanya 1 TP
- [x] Hanya 1 SL
- [x] Hitung R:R dari Preferred Entry
- [x] Implement configurable minimum R:R
- [x] Default minimum R:R 1:1.5
- [x] Implement LOW_RR
- [x] LOW_RR tidak mengurangi confidence
- [x] Persist risk calculation snapshot

---

# Milestone 17 — AI Risk Manager

- [x] Buat Risk Manager role prompt
- [x] Jalankan setelah Analyst terminal state
- [x] Berikan scanner context
- [x] Berikan AI voting
- [x] Berikan deterministic risk proposal
- [x] Default max output tokens = 2000
- [x] Validate structured output
- [x] Jika gagal → gunakan deterministic Risk Engine
- [x] Persist Risk Manager output
- [x] Persist fallback metadata

---

# Milestone 18 — Boss / Head Trader

- [x] Buat Boss role prompt
- [x] Berikan full scanner context
- [x] Berikan seluruh Analyst summaries
- [x] Berikan vote composition
- [x] Berikan Risk Engine
- [x] Berikan Risk Manager
- [x] Berikan H1/M15/M5 context
- [x] Default max output tokens = 2000
- [x] Implement majority BUY → BUY/NO_TRADE only
- [x] Implement majority SELL → SELL/NO_TRADE only
- [x] Larang reverse majority normal
- [x] Boss NO_TRADE normal → fallback majority AI
- [x] Boss tie-breaker → BUY/SELL/NO_TRADE
- [x] Boss NO_TRADE saat tie → scanner fallback
- [x] No scanner majority → NO_CONSENSUS
- [x] Persist Boss decision

---

# Milestone 19 — Final Confidence Engine

- [x] Implement configurable Scanner weight
- [x] Default Scanner = 30%
- [x] Implement configurable AI weight
- [x] Default AI = 40%
- [x] Implement configurable MTF weight
- [x] Default MTF = 30%
- [x] Validate total = 100%
- [x] Scanner Consensus = aligned scanners / 6
- [x] AI Consensus = aligned AI votes / 6
- [x] NO_TRADE tetap denominator
- [x] UNAVAILABLE tetap denominator
- [x] Implement H1 weight 30%
- [x] Implement M15 weight 45%
- [x] Implement M5 weight 25%
- [x] Validate MTF weights total 100%
- [x] Aligned = 100
- [x] Neutral default = 50
- [x] Opposing = 0
- [x] Neutral score configurable
- [x] Counter-trend menurunkan MTF score
- [x] Round UI output ke integer
- [x] Simpan precision value backend
- [x] LOW_RR tidak memengaruhi confidence

---

# Milestone 20 — Signal Engine

- [x] Buat internal signal UUID
- [x] Buat human Signal ID
- [x] Format `SIG-YYYYMMDD-XXXX`
- [x] Reset sequence 00:00 WIB
- [x] Jangan reuse nomor
- [x] Persist direction
- [x] Persist Entry Zone
- [x] Persist Preferred Entry
- [x] Persist SL
- [x] Persist TP
- [x] Persist R:R
- [x] Persist Final Confidence
- [x] Persist MTF context
- [x] Persist scanner composition
- [x] Persist AI composition
- [x] Persist flags
- [x] Persist config version
- [x] Persist Case ID
- [x] Implement LOW_RR flag
- [x] Implement COUNTER_TREND flag
- [x] Implement AI_DEGRADED flag
- [x] Implement SCANNER_FALLBACK flag
- [x] Implement MANUAL/EMERGENCY flags
- [x] Cegah duplicate signal

---

# Milestone 21 — Discord

- [ ] Configure Meeting Webhook
- [ ] Configure Signal Webhook
- [x] Buat `AI OFFICE MEETING STARTED`
- [x] Tampilkan scanner composition
- [x] Tampilkan BTCUSDT price
- [x] Tampilkan timestamp WIB
- [x] Tampilkan Case ID
- [x] Tampilkan View Live Case link
- [x] Buat Final Signal message
- [x] Tampilkan Entry Zone
- [x] Tampilkan Preferred Entry
- [x] Tampilkan TP
- [x] Tampilkan SL
- [x] Tampilkan R:R
- [x] Tampilkan Confidence
- [x] Tampilkan AI vote
- [x] Tampilkan Boss outcome
- [x] Tampilkan Signal ID
- [x] Tampilkan LOW_RR warning
- [x] Implement `Notify No Consensus`
- [x] Default Notify No Consensus OFF
- [x] Cegah duplicate Discord delivery
- [x] Persist Discord delivery result
- [x] Admin review pengiriman UNKNOWN/FAILED dengan konfirmasi dan audit permanen
- [x] Retry delay HTTP 429, batas empat percobaan, dan perlindungan pengiriman ambigu

---

# Milestone 22 — Public API

- [x] Setup `/api/v1`
- [x] `GET /api/v1/market/status`
- [x] `GET /api/v1/scanners`
- [x] `GET /api/v1/office/state`
- [x] `GET /api/v1/signals`
- [x] `GET /api/v1/signals/:id`
- [x] `GET /api/v1/cases/:id/public`
- [x] Pagination signals
- [x] Public Signals ON/OFF enforcement
- [x] Public Signal History ON/OFF enforcement
- [x] Public history limit setting
- [x] Redact Admin-only fields
- [~] Implement API rate limiting jika diperlukan (implementasi tersedia; uji integrasi tertunda)

---

# Milestone 23 — Admin API

- [x] Provider settings endpoints
- [x] Character settings endpoints
- [x] Prompt settings endpoints
- [x] Scanner settings endpoints
- [x] Risk settings endpoints
- [x] Confidence settings endpoints
- [x] Trading Config endpoints
- [~] Discord settings endpoints
- [x] Simulation endpoints
- [x] Emergency Meeting endpoints
- [x] Provider health endpoints
- [x] Usage endpoints
- [x] Apply config endpoints
- [x] Rollback prompt endpoints

---

# Milestone 24 — 2D Operational UI

## Global

- [~] Mobile-first navigation
- [~] Dark premium BYGA design
- [~] Responsive portrait
- [~] Responsive landscape
- [~] Loading states
- [~] Empty states
- [~] Error states
- [x] Offline/retry state

## Office HUD

- [~] BTCUSDT price
- [~] office state
- [~] scanner statuses
- [~] next scan
- [~] case status
- [~] signal status
- [~] navigation

## Signals

- [~] Signals list
- [~] Signal detail
- [~] BUY/SELL filter
- [~] Date filter
- [~] Case ID filter
- [~] Signal ID filter
- [~] Confidence range filter
- [~] LOW_RR filter
- [~] COUNTER_TREND filter
- [~] AI_DEGRADED filter
- [x] Scanner trigger filter
- [~] AUTO/MANUAL filter
- [~] Pagination

## Cases

- [~] Cases list
- [~] Case detail
- [~] Timeline
- [~] Scanner snapshot
- [~] Analyst results
- [~] Voting
- [~] Risk
- [~] Boss
- [~] Config version
- [~] Provider/model metadata Admin-only (UI/API tersedia; uji integrasi/browser tertunda)

## Scanners

- [~] Scanner Command Center
- [~] Trend detail page
- [~] Breakout detail page
- [~] Momentum detail page
- [~] Mean Reversion detail page
- [~] Structure detail page
- [~] Liquidity detail page

## Characters

- [~] Characters page
- [~] Character detail page
- [~] Current state
- [~] Latest vote
- [~] Confidence
- [~] Provider/model Admin-only (UI/API tersedia; uji integrasi/browser tertunda)
- [~] Warning state
- [~] History

## Admin

- [~] Settings page
- [~] Provider page
- [~] Character config
- [~] Prompt config
- [~] Trading Config version UI
- [~] Risk config
- [~] Confidence config
- [~] MTF config
- [~] Discord config
- [~] Provider health
- [~] Usage summary

---

# Milestone 25 — Public Signal UI

- [~] Implement `Public Signals` setting
- [~] Public signal detail
- [~] Public signal history
- [~] Summary reasoning
- [~] Scanner composition
- [~] AI vote composition
- [~] H1/M15/M5
- [~] LOW_RR warning
- [~] COUNTER_TREND warning
- [~] Generic semantic quality warning
- [~] Jangan tampilkan provider debug
- [~] Jangan tampilkan full prompt
- [~] Jangan tampilkan raw AI response
- [~] Jangan tampilkan secrets

---

# Milestone 26 — Realtime Office State

- [x] Buat office state endpoint
- [ ] Implement SSE jika stabil
- [x] Implement polling fallback
- [~] State MONITORING
- [~] State WATCHING
- [~] State TRIGGERED
- [~] State AI_ANALYSIS
- [~] State RISK_REVIEW
- [~] State BOSS_DECISION
- [~] State DISCORD
- [~] State RETURN_TO_DESK
- [x] Reconnect handling
- [x] Jangan jadikan browser source of truth

---

# Milestone 27 — 3D Office Base

- [~] Setup React Three Fiber
- [~] Setup scene
- [~] Setup camera isometric
- [~] Limited rotation
- [~] Pan
- [~] Zoom
- [~] Reset View
- [~] Mobile pinch zoom
- [~] Mobile drag pan
- [~] Mobile two-finger rotate
- [~] Setup lighting
- [~] Setup luxury modern materials
- [~] Setup BYGA/BG branding

---

# Milestone 28 — 3D Office Rooms

- [~] BYGA Lobby
- [~] Analyst Floor
- [~] Scanner Command Center
- [~] Market Wall
- [~] Risk Office
- [~] War Room / Meeting Room
- [~] Boss Office
- [~] Server/Data Room
- [~] Lounge / Pantry
- [~] Hallway / walking paths
- [~] Musolla

---

# Milestone 29 — 3D Characters

- [~] Model/preset Trend Analyst
- [~] Model/preset Structure Analyst
- [~] Model/preset Momentum Analyst
- [~] Model/preset Liquidity Analyst
- [~] Model/preset Volume Analyst
- [~] Model/preset Quant Analyst
- [~] Model/preset Risk Manager
- [~] Model/preset Boss
- [ ] Character customization config
- [~] Idle animation
- [~] Typing animation
- [~] Monitor animation
- [~] Walking animation
- [~] Meeting animation
- [~] Boss notification/phone animation
- [~] Return-to-desk animation

---

# Milestone 30 — Character Navigation

- [~] Buat waypoint graph
- [~] Desk → War Room path
- [~] Desk → Lounge path
- [~] Desk → Musolla path
- [~] Risk Office routes
- [~] Boss Office routes
- [x] Prevent obvious collision terhadap meja/dinding (antar-karakter masih terbuka)
- [~] Character walk instead of teleport
- [ ] Implement safe teleport fallback only jika path gagal

---

# Milestone 31 — Living Office

- [~] MONITORING animation
- [~] WATCHING animation
- [~] TRIGGERED animation
- [~] AI_ANALYSIS animation
- [~] RISK_REVIEW animation
- [~] BOSS_DECISION animation
- [~] DISCORD animation
- [~] RETURN_TO_DESK animation
- [~] Idle desk activity
- [~] Coffee/lounge activity
- [~] Relevant Analyst react pada WATCHING
- [~] Decorative behavior tidak memanggil AI

---

# Milestone 32 — Character Interaction UI

- [~] Click/tap character
- [~] Speech bubble
- [~] Name
- [~] Role
- [~] Current status
- [~] Short live summary
- [~] `Lihat Detail`
- [~] Public summary view
- [~] Admin expanded view

---

# Milestone 33 — Market Wall

- [~] Lightweight decorative chart in 3D
- [~] Click/tap interaction
- [~] Open real chart panel
- [~] H1
- [~] M15
- [~] M5
- [~] Data dari `chart_db`
- [~] Responsive chart panel
- [~] WIB timestamps

---

# Milestone 34 — Server/Data Room

- [~] chart_db health
- [~] Trading Office API health
- [~] AI Providers aggregate health
- [~] Discord health
- [~] OK / DEGRADED / DOWN visual
- [~] Admin provider detail
- [~] Circuit breaker detail Admin-only

---

# Milestone 35 — Musolla

- [~] Buat tombol `Sholat`
- [~] Manual trigger only
- [~] Available characters berjalan ke Musolla
- [~] Trading workflow priority
- [~] Queue Sholat request jika case aktif
- [~] Return characters setelah sequence selesai
- [~] Pastikan tidak mengubah trading state/data

---

# Milestone 36 — Adaptive 3D Quality

- [~] Detect performance capability
- [x] Low/medium/high quality profile
- [~] Reduce shadows pada low-end
- [ ] Reduce texture resolution
- [~] Reduce anti-aliasing
- [~] Reduce decorative animation
- [ ] Reduce particles
- [~] Implement LOD (detail mesh prosedural; asset LOD masih terbuka)
- [x] Implement instancing untuk repetitive props
- [~] Lazy-load noncritical assets
- [ ] Compress textures
- [ ] Draco/Meshopt jika sesuai

---

# Milestone 37 — WebGL Fallback

- [x] Detect WebGL failure
- [x] Tampilkan 2D Operations Dashboard
- [x] Scanner tetap usable
- [~] Signal tetap usable
- [x] Admin tetap usable
- [~] Trading backend tetap berjalan tanpa WebGL

---

# Milestone 38 — Emergency Meeting

- [~] Admin button `CALL EMERGENCY MEETING`
- [~] Neutral Analysis mode
- [~] Investigate BUY mode
- [~] Investigate SELL mode
- [~] Gunakan latest closed H1/M15/M5
- [~] Tetap jalankan 6 scanner
- [~] Bypass normal scanner trigger
- [~] AI bebas voting
- [~] AI majority sebagai arah jika scanner tidak majority
- [~] Boss tie-breaker
- [~] Boss NO_TRADE → scanner fallback
- [~] No scanner majority → NO_CONSENSUS
- [~] Badge MANUAL / EMERGENCY
- [~] Masuk Live Signals
- [~] `Send to Discord` toggle
- [~] Default toggle OFF

---

# Milestone 39 — Simulation

- [~] Historical candle selector
- [~] Historical snapshot loader
- [~] Run 6 scanners
- [~] Run 6 AI Analysts
- [~] Run voting
- [~] Run Risk Engine
- [~] Run Risk Manager
- [~] Run Boss
- [~] Generate simulated final result
- [~] Isolate from Live Signals
- [~] Store di `/simulation/history`
- [~] Discord default OFF
- [~] Playback 1x
- [~] Playback 2x
- [~] Playback 4x
- [~] Skip to Result
- [~] CURRENT CONFIG mode
- [~] HISTORICAL CONFIG mode
- [~] STRICT REPLAY
- [~] COMPATIBLE REPLAY
- [~] Persist replay mode
- [~] Handle unavailable historical model clearly

---

# Milestone 40 — AI Usage & Budget Controls

- [x] Max AI cases/day
- [x] Max estimated tokens/case
- [x] Max calls/case
- [~] Case cooldown
- [x] Emergency limit
- [x] Simulation limit
- [x] Default unlimited/OFF
- [x] Track calls today
- [x] Track estimated tokens today
- [x] Reset 00:00 WIB
- [~] Usage display Admin

---

# Milestone 41 — Retention

- [x] Structured AI output permanent
- [x] Case summary permanent
- [x] Signal permanent
- [x] Scanner snapshot permanent
- [x] Config versions permanent
- [x] Prompt versions permanent
- [x] Risk result permanent
- [x] Boss result permanent
- [~] Raw provider response retention
- [~] Rendered prompt retention
- [x] Default retention 90 hari
- [x] Retention configurable
- [~] Scheduled cleanup
- [x] Redact secrets sebelum storage

---

# Milestone 42 — Security Hardening

- [x] Audit client bundle untuk secrets
- [~] Audit API authorization
- [~] Validate all Admin input
- [x] Sanitize provider response
- [x] Escape rendered content
- [x] Protect mutation endpoints
- [x] CSRF-safe strategy
- [x] Login rate limiting
- [~] API rate limiting (implementasi D1 + uji concurrency tersedia; eksekusi integrasi tertunda)
- [~] Secure cookie review
- [x] Restrict chart_db writes
- [x] Restrict raw AI logs ke Admin
- [x] Restrict prompt logs ke Admin
- [x] Restrict circuit breaker state ke Admin
- [x] Test session expiration
- [x] Test unauthorized access

---

# Milestone 43 — Reliability & Idempotency

- [x] Duplicate M5 candle test
- [x] Duplicate case creation test
- [x] Duplicate signal creation test
- [x] Duplicate Discord delivery test
- [x] Retry-safe endpoints
- [~] Worker restart recovery
- [~] Queue recovery
- [~] Active case recovery
- [~] Provider timeout recovery
- [x] Provider fallback recovery
- [~] D1 temporary failure handling
- [~] Discord failure handling

---

# Milestone 44 — Testing

## Unit

- [x] Indicators
- [x] Structure detection
- [x] Scanner rules
- [x] Trigger engine
- [x] MTF scoring
- [x] Confidence formula
- [x] Risk calculations
- [x] R:R calculation
- [x] ID generation
- [x] Semantic validator
- [x] Voting
- [x] Circuit breaker

## Integration

- [x] chart_db → scanner
- [x] scanner → case
- [x] case → AI
- [x] AI → voting
- [x] voting → risk
- [x] risk → Boss
- [x] Boss → signal
- [x] signal → Discord
- [x] Simulation flow
- [x] Emergency flow

## E2E

- [~] Normal BUY flow
- [~] Normal SELL flow
- [~] Scanner tie
- [~] AI tie
- [~] All AI NO_TRADE
- [~] AI_DEGRADED
- [~] Provider primary failure
- [~] Fallback success
- [~] Primary + fallback failure
- [~] Semantic validation failure
- [~] LOW_RR
- [~] COUNTER_TREND
- [~] Queue stale
- [~] Direction changed
- [~] Config changed
- [~] NO_CONSENSUS
- [~] Public Signals ON
- [~] Public Signals OFF

---

# Milestone 45 — Mobile QA

- [~] Android portrait (Chromium emulasi Pixel 7 lulus; perangkat fisik belum)
- [~] Android landscape (Chromium emulasi Pixel 7 lulus; perangkat fisik belum)
- [x] Small screen (viewport 320 px diuji)
- [ ] Mid-range device
- [ ] Low-end device
- [ ] Touch gestures
- [ ] Bottom sheets
- [ ] 3D frame rate
- [ ] Character tap target
- [ ] Market Wall tap
- [~] Scanner panels
- [ ] Signal detail
- [~] Admin forms

---

# Milestone 46 — Performance Optimization

- [x] Measure initial bundle
- [x] Code split 3D
- [x] Lazy-load Admin (chunk build terpisah; QA browser baru masih tertunda)
- [x] Lazy-load Simulation (chunk build terpisah; QA browser baru masih tertunda)
- [ ] Optimize GLB/GLTF
- [ ] Optimize textures
- [~] Optimize D1 queries
- [x] Add indexes
- [x] Paginate histories
- [x] Avoid unnecessary provider calls
- [x] Cache model lists
- [~] Cache safe static configuration
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

1. [~] Milestone 0–4: Foundation
2. [~] Milestone 5–7: Indicators, scanners, trigger
3. [~] Milestone 8: Case queue/orchestrator
4. [~] Milestone 9–14: AI provider + analysts
5. [~] Milestone 15–20: Voting, risk, Boss, signal
6. [~] Milestone 21: Discord
7. [~] Milestone 22–25: API + 2D UI
8. [~] Milestone 26–37: Realtime + 3D Office
9. [~] Milestone 38–39: Emergency + Simulation
10. [~] Milestone 40–47: Usage, retention, testing, security, production
