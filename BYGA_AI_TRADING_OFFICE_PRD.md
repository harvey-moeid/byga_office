# PRD — BYGA AI Trading Office

**Version:** 1.0  
**Status:** MVP Specification  
**Primary Market:** BTCUSDT  
**Primary Timezone UI:** WIB / Asia/Jakarta  
**Architecture:** Cloudflare-first  
**Product Type:** Interactive 3D AI Trading Analysis Office

---

## 1. Product Vision

BYGA AI Trading Office adalah aplikasi web trading-analysis berbentuk **kantor trading 3D interaktif**.

Sistem menggabungkan:

- deterministic trading scanners,
- multi-agent AI analysis,
- deterministic risk engine,
- AI Risk Manager,
- AI Boss / Head Trader,
- structured voting,
- confidence scoring,
- signal generation,
- Discord notifications,
- interactive 3D visualization.

Tujuan produk bukan sekadar menghasilkan BUY/SELL, tetapi membuat seluruh proses analisis dapat **dilihat, ditelusuri, dijelaskan, dikonfigurasi, dan diaudit**.

Pengguna melihat sebuah kantor miniatur yang hidup. Enam AI Analyst bekerja di meja masing-masing, Risk Manager berada di Risk Office, dan Boss berada di Boss Office.

Ketika market memenuhi trigger, seluruh kantor bertransisi dari monitoring ke proses analisis hingga keputusan final.

---

## 2. MVP Scope

### Market
- BTCUSDT

### Timeframes
- H1
- M15
- M5

Hierarki timeframe:

- **H1** → Market Bias / Regime
- **M15** → Trading Setup / Structure
- **M5** → Entry Trigger / Execution refinement

Sumber candle berasal dari existing Cloudflare D1:

`chart_db`

Database tersebut bersifat **READ ONLY**.

BYGA AI Trading Office tidak boleh melakukan `INSERT`, `UPDATE`, atau `DELETE` terhadap `chart_db`.

---

## 3. Product Principles

### Deterministic before AI
Scanner, trigger, confidence calculation, risk baseline, dan validation sebisa mungkin deterministic.

### AI is explainable
Setiap keputusan AI harus memiliki structured output.

### One Case = One Immutable Context
Satu case tidak boleh menggunakan campuran konfigurasi berbeda.

### Graceful degradation
Kegagalan satu provider/model tidak boleh otomatis menghentikan seluruh sistem.

### Auditability
Case menyimpan snapshot input, scanner, configuration version, model, provider, voting, risk, dan keputusan final.

### Mobile First
Pengalaman mobile bukan versi desktop yang diperkecil.

---

## 4. High-Level Architecture

### Frontend
- React
- Three.js / React Three Fiber
- WebGL rendering di browser
- Mobile-first responsive UI

### Backend
- Cloudflare Workers

### Storage
- `chart_db` → existing market data, read-only
- `trading_office_db` → application database
- Cloudflare R2 → 3D models, textures, GLB/GLTF, static assets

Cloudflare Worker menangani:
- scanner orchestration
- case orchestration
- AI provider adapters
- voting
- Risk Engine
- Risk Manager
- Boss
- configuration
- Discord
- Admin authentication
- Simulation

Secrets disimpan menggunakan **Cloudflare Worker Secrets**.

Tidak ada API key AI di browser atau D1.

---

## 5. Main Trading Workflow

```text
Closed M5 Candle
↓
Run 6 Deterministic Scanners
↓
Evaluate Scanner Trigger
↓
Create Analysis Case
↓
6 AI Analysts run in parallel
↓
Majority Voting
↓
Deterministic Risk Engine
↓
AI Risk Manager
↓
Boss / Head Trader
↓
Final Confidence Engine
↓
Create Signal
↓
Discord Notification
↓
Office returns to Monitoring
```

---

## 6. Scanner Trigger Rules

Scanner dijalankan setelah setiap **closed M5 candle**.

Tambahkan short processing delay untuk memastikan candle benar-benar final.

Gunakan `last_processed_candle` untuk mencegah duplicate scan.

AI Office hanya aktif ketika:
- minimal 2 scanner memberikan arah yang sama;
- satu arah memiliki jumlah scanner lebih tinggi secara unik.

Contoh:
- `3 BUY / 2 SELL / 1 NONE` → BUY trigger
- `2 BUY / 2 SELL / 2 NONE` → tidak ada trigger

Tie tidak menjalankan AI Office.

---

## 7. Six Deterministic Trading Systems

### 7.1 Trend Following Scanner
Fokus:
- EMA 20
- EMA 50
- EMA 200
- ADX
- HH/HL
- LH/LL
- trend continuation

Output: `BUY / SELL / NONE`

### 7.2 Breakout & Retest Scanner
Fokus:
- support/resistance
- breakout
- retest
- ATR
- volume confirmation
- candle confirmation

### 7.3 Momentum Scanner
Fokus:
- RSI
- MACD
- ROC
- candle momentum
- volume
- momentum continuation/exhaustion

### 7.4 Mean Reversion Scanner
Fokus:
- Bollinger Bands
- RSI
- deviation
- overextension
- reversion probability

### 7.5 Market Structure / Price Action Scanner
Fokus:
- HH / HL
- LH / LL
- BOS
- CHoCH
- swing structure
- structural continuation/reversal

### 7.6 Liquidity / SMC Scanner
Fokus:
- liquidity high/low
- liquidity sweep
- FVG
- order-block approximation
- displacement
- liquidity reaction

---

## 8. Scanner Output Contract

Semua scanner menghasilkan:

```text
direction
strength
h1_bias
m15_setup
m5_trigger
reasons[]
levels[]
indicators{}
timestamp
candle_timestamp
config_version
```

`direction`: `BUY | SELL | NONE`

`strength`: `0–100`

Strength hanya informational dan tidak memengaruhi:
- trigger
- voting
- Final Confidence

Scanner dengan `NONE` tetap wajib menghasilkan `reasons[]`.

Snapshot indikator lengkap yang dipakai scanner wajib disimpan.

---

## 9. Scanner Configuration

Semua 6 scanner selalu aktif.

MVP tidak memiliki toggle disable per scanner.

Parameter scanner dapat diedit melalui Admin.

Logic inti scanner tetap berada di code.

Setiap perubahan menghasilkan Trading Config Version baru.

Contoh:

`TRADING-CONFIG-v17`

---

## 10. AI Trading Office Characters

Total **8 AI Characters**.

Enam Analyst:
1. Trend Analyst
2. Structure Analyst
3. Momentum Analyst
4. Liquidity Analyst
5. Volume Analyst
6. Quant Analyst

Tambahan:
7. Risk Manager
8. Boss / Head Trader

---

## 11. Analyst Specialization

- Trend Analyst ↔ Trend Scanner
- Structure Analyst ↔ Market Structure Scanner
- Momentum Analyst ↔ Momentum Scanner
- Liquidity Analyst ↔ Liquidity / SMC Scanner
- Volume Analyst ↔ Breakout / Volume Scanner
- Quant Analyst ↔ Mean Reversion / Statistical analysis

Semua Analyst menerima context penuh:
- H1 OHLCV
- M15 OHLCV
- M5 OHLCV
- 6 scanner outputs
- indicator snapshots
- market structure
- active case metadata

Analyst bebas tidak setuju dengan scanner.

---

## 12. AI Analysis Model

MVP hanya menggunakan **1 AI analysis round**.

Tidak ada multi-round debate.

Enam Analyst dipanggil **secara parallel**.

Setiap Analyst bekerja independen dan tidak melihat jawaban Analyst lain.

Output Analyst:

```text
vote
confidence
summary
reasoning
evidence[]
risk_flags[]
```

Vote: `BUY | SELL | NO_TRADE`

Confidence individual: `0–100`

Confidence individual hanya informational.

Prinsip:

**1 Analyst = 1 Vote**

---

## 13. AI Providers

Provider MVP:
- OpenAI
- Google Gemini
- Groq
- OpenRouter
- Mistral
- Hugging Face
- Cohere
- NVIDIA

Secrets:

```text
OPENAI_API_KEY
GEMINI_API_KEY
GROQ_API_KEY
OPENROUTER_API_KEY
MISTRAL_API_KEY
HF_TOKEN
COHERE_API_KEY
NVIDIA_API_KEY
```

Semua credential berada di Worker Secrets.

---

## 14. Dynamic Model Discovery

Settings mencoba mengambil daftar model provider secara dinamis jika API mendukungnya.

UI menyediakan:
- Model Dropdown
- Custom Model ID fallback

---

## 15. Character AI Configuration

Setiap karakter mempunyai:

```text
primary_provider
primary_model
fallback_provider
fallback_model
temperature
max_output_tokens
primary_timeout
fallback_timeout
custom_instructions
personality
avatar/model preset
```

Role inti tidak dapat dihapus Admin.

---

## 16. Prompt Architecture

Prompt terdiri dari:
- Locked Core Role Prompt
- Admin Editable Custom Instructions
- Admin Editable Personality
- Locked Structured Output Contract

Core Role menentukan kompetensi karakter.

Personality hanya memengaruhi gaya karakter, bukan aturan trading.

---

## 17. Prompt Versioning

Setiap perubahan Custom Instructions atau Personality membuat `prompt_version` baru.

Versi lama immutable.

Admin dapat rollback.

Setiap AI response menyimpan `prompt_version` yang digunakan.

---

## 18. AI Context

MVP menggunakan **Stateless AI**.

Setiap case dianalisis tanpa memory case sebelumnya.

Default raw candle context:
- H1 → 50 candles
- M15 → 100 candles
- M5 → 100 candles

Jumlah dapat diedit di Admin.

---

## 19. Smart Context Compression

Jika context terlalu besar:
1. prioritaskan raw candle terbaru;
2. candle lama dikompresi menjadi statistik/indicator summary;
3. jika masih terlalu besar, truncate candle terlama.

Case menyimpan:

`context_compressed = true/false`

---

## 20. Structured Output

Jika provider mendukung JSON Schema / structured output native, gunakan fitur native.

Jika tidak, gunakan strict JSON prompt + backend parser + validator.

Hanya parsed structured output yang masuk pipeline normal.

---

## 21. Semantic Validation

Backend memiliki deterministic semantic validator.

Validator mengecek konsistensi:
- vote
- directional bias
- reason codes
- evidence
- risk flags
- BUY/SELL direction
- price relationships

Jika response semantic invalid, retry mengikuti provider policy.

Jika primary + fallback masih invalid setelah retry, vote response terakhir tetap digunakan.

Response diberi:

`SEMANTIC_VALIDATION_FAILED`

Confidence asli model tetap ditampilkan.

Severity:
- first validation failure → warning kuning
- persistent failure → merah

Warning melekat pada karakter, bukan otomatis case-level degradation.

Public Viewer hanya melihat pesan umum:

`AI response quality issue detected`

Admin melihat detail validator.

---

## 22. Provider Retry System

Retry configurable per provider.

Default:
- Primary: initial request + 1 retry
- Fallback: initial request + 1 retry

Maximum normal attempts: **4 attempts per character**

Retry memakai:
- exponential backoff
- jitter

Jitter default aktif.

---

## 23. Provider Fallback

Setiap karakter memiliki:
- 1 primary provider/model
- 1 fallback provider/model

Fallback boleh:
- provider berbeda
- provider sama dengan model berbeda

Fallback mempertahankan:
- Core Role
- Custom Instructions
- Personality
- Structured Schema

Fallback boleh memiliki:
- temperature berbeda
- max tokens berbeda
- timeout berbeda

Jika fallback berhasil, vote dianggap normal.

Internal flag:

`MODEL_FALLBACK_USED`

Hanya Admin yang melihat badge fallback.

---

## 24. Provider Circuit Breaker

Per-provider circuit breaker configurable.

Default:
- 3 consecutive failures
- circuit → `OPEN`
- cooldown → 5 minutes

Saat circuit OPEN:
- primary request dilewati
- sistem langsung memakai fallback

Setelah cooldown:
- `HALF_OPEN`

Jika test berhasil:
- `CLOSED`

Jika gagal:
- kembali `OPEN`

Circuit breaker state hanya terlihat oleh Admin.

---

## 25. AI Provider Health

Server Room menunjukkan aggregate status:
- `OK`
- `DEGRADED`
- `DOWN`

Admin dapat membuka detail provider.

Health menggunakan hybrid model:
- passive status berdasarkan request terakhir
- manual `Test Connection`

Tidak ada paid provider polling berkala.

---

## 26. Analyst Success Threshold

Minimal **3 dari 6 Analyst** harus berhasil untuk normal AI consensus.

Jika kurang dari 3:
- case → `AI_DEGRADED`
- arah fallback menggunakan scanner direction
- case tetap boleh menghasilkan signal

---

## 27. Analyst UNAVAILABLE

Jika provider/fallback gagal, Analyst menjadi:

`UNAVAILABLE`

UNAVAILABLE tetap dianggap bagian dari total 6 untuk AI Consensus calculation.

Contoh:
- 3 BUY
- 1 SELL
- 2 UNAVAILABLE

AI Consensus:

`3 / 6 = 50%`

---

## 28. Voting Rules

`NO_TRADE` adalah abstain untuk pemilihan arah.

Contoh:
- 2 BUY
- 1 SELL
- 3 NO_TRADE

→ BUY menang 2 vs 1.

Final Confidence tetap menghitung jumlah total 6 Analyst.

---

## 29. AI Tie

Jika BUY = SELL, Boss bertindak sebagai tie-breaker.

Dalam tie, Boss boleh memilih:
- BUY
- SELL
- NO_TRADE

Jika Boss memilih NO_TRADE:
- cek scanner unique majority
- jika ada → gunakan scanner direction + `SCANNER_FALLBACK`
- jika tidak → `NO_CONSENSUS`

Tidak ada signal pada `NO_CONSENSUS`.

---

## 30. All Analysts NO TRADE

Jika:

`0 BUY / 0 SELL / 6 NO_TRADE`

gunakan scanner trigger direction.

---

## 31. Risk Engine

Risk calculation memiliki dua layer:

**Deterministic Risk Engine**

↓

**AI Risk Manager**

Deterministic engine harus bekerja walaupun AI Risk Manager gagal.

---

## 32. Entry Zone

Signal menggunakan:

```text
entry_low
entry_high
preferred_entry
```

Entry Zone menggunakan hybrid:

**M15 market structure / support-resistance + ATR buffer**

Preferred Entry:

```text
(entry_low + entry_high) / 2
```

Risk Manager tidak boleh secara subjektif mengubah Preferred Entry.

---

## 33. Stop Loss

SL menggunakan:

**Structural invalidation / swing + ATR buffer**

BUY:
- SL di bawah struktur yang menginvalidasi setup

SELL:
- SL di atas struktur yang menginvalidasi setup

---

## 34. Take Profit

Hanya **1 Take Profit**.

TP berdasarkan:
- structure
- support/resistance
- liquidity target

TP tidak boleh dipaksakan hanya untuk memenuhi minimum Risk:Reward.

---

## 35. Risk:Reward

Risk:Reward dihitung dari **Preferred Entry**.

BUY:

```text
Risk = Preferred Entry - SL
Reward = TP - Preferred Entry
```

SELL:

```text
Risk = SL - Preferred Entry
Reward = Preferred Entry - TP
```

---

## 36. Minimum Risk:Reward

Minimum R:R configurable.

Default:

**1 : 1.5**

Minimum tersebut bukan hard rejection.

Jika hasil berada di bawah minimum:
- signal tetap diterbitkan
- tambahkan `LOW_RR`

Contoh Discord:

`⚠ LOW R:R — 1:1.10 (minimum 1:1.50)`

LOW_RR tidak menurunkan Final Confidence.

---

## 37. Risk Manager

Risk Manager berjalan setelah seluruh Analyst mencapai terminal state:
- SUCCESS
- TIMEOUT
- UNAVAILABLE

Risk Manager menerima:
- OHLCV
- scanner outputs
- Analyst voting
- deterministic Risk Engine proposal
- Entry Zone
- Preferred Entry
- SL
- TP
- R:R

Jika Risk Manager gagal:
- gunakan deterministic Risk Engine apa adanya
- signal/case diberi degraded metadata terkait fallback

---

## 38. Boss / Head Trader

Boss menerima:
- full scanner context
- all Analyst summaries
- vote composition
- Risk Engine
- Risk Manager
- H1/M15/M5 context

Boss tidak hanya membaca jumlah vote.

Pada normal majority:
- majority BUY → Boss hanya BUY / NO_TRADE
- majority SELL → Boss hanya SELL / NO_TRADE

Boss tidak boleh membalik arah normal majority.

Jika Boss memilih NO_TRADE pada normal majority:
- final direction fallback ke majority AI

Boss NO_TRADE tetap tersimpan sebagai disagreement.

---

## 39. Final Confidence

Confidence bersifat deterministic.

Default formula:

**30% Scanner Consensus + 40% AI Vote Consensus + 30% MTF Alignment**

Bobot configurable di Admin.

Total harus selalu 100%.

---

## 40. Scanner Consensus

Formula:

```text
number_of_scanners_matching_final_direction / 6 × 100
```

NONE tetap masuk denominator.

---

## 41. AI Vote Consensus

Formula:

```text
number_of_AI_votes_matching_final_direction / 6 × 100
```

Denominator selalu 6.

NO_TRADE dan UNAVAILABLE tidak mendukung arah final.

Confidence individual AI tidak digunakan.

---

## 42. MTF Alignment

Default weight:
- H1 → 30%
- M15 → 45%
- M5 → 25%

Configurable.

Total harus 100%.

Direction score default:
- Aligned → 100
- Neutral → 50
- Opposing → 0

Nilai NEUTRAL configurable.

---

## 43. Counter-Trend

Jika final direction berlawanan dengan H1:
- signal tetap boleh diterbitkan
- tambahkan `COUNTER_TREND`
- MTF Alignment otomatis lebih rendah

Jika H1 `NEUTRAL`, bukan conflict dan tidak perlu warning khusus.

---

## 44. Final Confidence Display

UI menampilkan integer percentage.

Contoh:

`78%`

Backend boleh menyimpan nilai presisi lebih tinggi.

Tidak digunakan kategori HIGH / LOW / VERY HIGH.

---

## 45. Signal Contract

```text
signal_uuid
signal_id
case_uuid
case_id
market
direction
entry_low
entry_high
preferred_entry
stop_loss
take_profit
risk_reward
confidence
h1_bias
m15_setup
m5_trigger
scanner_composition
ai_vote_composition
flags[]
source
created_at
config_version
```

Direction signal:

`BUY | SELL`

---

## 46. Signal Flags

Contoh:
- LOW_RR
- COUNTER_TREND
- AI_DEGRADED
- SCANNER_FALLBACK
- MANUAL
- EMERGENCY
- MODEL_FALLBACK_USED
- SEMANTIC_VALIDATION_FAILED

Tidak semua flags public.

---

## 47. Case ID and Signal ID

Database menggunakan UUID.

UI menggunakan human-readable ID:

```text
CASE-YYYYMMDD-XXXX
SIG-YYYYMMDD-XXXX
```

Tanggal berdasarkan WIB.

Sequence reset setiap hari.

Nomor tidak pernah digunakan kembali.

Cancelled case tetap mempertahankan ID.

---

## 48. URL Structure

```text
/cases/CASE-20261003-0001
/signals/SIG-20261003-0001
```

UUID tetap internal.

---

## 49. Queue

Hanya **1 active AI case** pada satu waktu.

Trigger baru masuk queue.

Tidak ada parallel meeting karena karakter 3D hanya dapat berada dalam satu workflow pada satu waktu.

---

## 50. Queue Revalidation

Ketika pending case mendapat giliran:
- 6 scanner dijalankan ulang menggunakan latest closed M5 candle
- jika setup lama sudah tidak valid → `STALE / CANCELLED`
- AI tidak dipanggil

---

## 51. Direction Change During Queue

Jika queued BUY berubah menjadi SELL:
- case BUY lama → `DIRECTION_CHANGED`
- sistem membuat Case ID baru untuk SELL

Satu Case ID tidak boleh berubah arah di tengah lifecycle.

---

## 52. Trigger Cooldown

Directional cooldown configurable.

Default:

**15 minutes**

BUY dan SELL memiliki cooldown terpisah.

Anchor configurable:
- `FROM_TRIGGER`
- `FROM_FINAL_DECISION`

Default:

`FROM_TRIGGER`

---

## 53. Trading Config Versioning

Semua deterministic config berada dalam satu immutable snapshot:

`TRADING-CONFIG-v17`

Snapshot mencakup:
- scanner params
- ATR params
- Entry Zone params
- SL params
- TP params
- min R:R
- confidence weights
- MTF weights
- neutral value
- cooldown
- context settings
- deterministic parameters lain

---

## 54. Configuration Activation

Admin dapat memilih:
- `NEXT CASE`
- `APPLY NOW`

`NEXT CASE`:
- active case tetap memakai config sebelumnya

`APPLY NOW`:
- active case dibatalkan dengan status `CONFIG_CHANGED`
- case baru dibuat memakai config baru
- wajib confirmation dialog

---

## 55. Emergency Meeting

Admin memiliki:

`CALL EMERGENCY MEETING`

Emergency Meeting menggunakan latest closed:
- H1
- M15
- M5

Tetap menjalankan 6 scanners untuk context.

Bypass normal scanner-trigger requirement.

Mode:
- Neutral Analysis
- Investigate BUY
- Investigate SELL

Investigate direction hanya focus/context dan tidak memaksa hasil.

---

## 56. Emergency Voting

Jika scanner tidak memiliki majority:
- AI majority menjadi sumber arah utama

Jika AI tie:
- Boss menjadi tie-breaker

Jika Boss memilih NO_TRADE:
- cek scanner unique majority
- jika ada → `SCANNER_FALLBACK`
- jika tidak → `NO_CONSENSUS`

---

## 57. Emergency Signals

Emergency result adalah **LIVE signal** dan masuk halaman Signals utama.

Badge:

`MANUAL / EMERGENCY`

Emergency dialog memiliki:

`Send to Discord`

Default untuk manual testing:

**OFF**

---

## 58. Simulation Mode

Simulation Mode tersedia dalam MVP.

Admin memilih historical candle/snapshot dari `chart_db`.

Simulation menjalankan seluruh pipeline:
- 6 scanners
- 6 AI Analysts
- voting
- Risk Engine
- Risk Manager
- Boss
- final result
- office animation

Simulation terisolasi dari Live Trading Office.

Discord default OFF.

---

## 59. Simulation Speed

Visual playback:
- 1×
- 2×
- 4×

Jika backend processing selesai:
- `Skip to Result`

---

## 60. Simulation History

Simulation tidak masuk `/signals`.

Gunakan:

`/simulation/history`

Live dan Simulation tidak boleh bercampur.

---

## 61. Simulation Configuration

Admin dapat memilih:
- CURRENT CONFIG
- HISTORICAL CONFIG

Historical tersedia jika version snapshot ditemukan.

---

## 62. Historical AI Replay

Mode:

### STRICT REPLAY
Gunakan provider/model historis.

Jika model/provider sudah tidak tersedia:
- simulation gagal dengan alasan jelas

### COMPATIBLE REPLAY
Gunakan historical scanner/config tetapi provider/model AI yang aktif sekarang.

Simulation wajib mencatat replay mode.

---

## 63. Signal Lifecycle

MVP berhenti setelah signal diterbitkan.

MVP tidak melakukan automatic tracking:
- WAITING ENTRY
- ACTIVE
- TP HIT
- SL HIT
- EXPIRED

Signal snapshot tetap disimpan untuk Phase 2.

---

## 64. Phase 2 Performance

Phase 2 dapat menambahkan:
- Total Signals
- Win Rate
- Loss Rate
- TP Hit
- SL Hit
- Expired
- Average R:R
- Profit Factor
- Expectancy
- performance per scanner
- performance per direction
- performance per AI model/provider
- performance per config version

---

## 65. Discord Integration

Gunakan dua webhook configurable:
- Meeting Webhook
- Signal Webhook

Keduanya boleh memiliki URL yang sama.

Secrets/webhook URL tidak pernah dikirim ke public client.

---

## 66. Meeting Started Notification

Saat normal scanner trigger terjadi, kirim:

`AI OFFICE MEETING STARTED`

Informasi:
- BTCUSDT
- trigger direction
- scanner composition
- price
- timestamp WIB
- Case ID
- View Live Case link

---

## 67. Final Signal Notification

Boss Final Decision notification mencakup:
- BUY / SELL
- Entry Zone
- Preferred Entry
- TP
- SL
- R:R
- Final Confidence
- scanner composition
- AI voting
- Boss outcome
- warning flags
- Signal ID
- View Analysis

Jika LOW_RR, warning wajib terlihat jelas.

---

## 68. NO_CONSENSUS Notification

Setting:

`Notify No Consensus`

Default OFF.

Jika ON:
- notification dikirim ke Meeting Webhook
- bukan Signal Webhook

---

## 69. Discord Animation

Saat Boss final decision dikirim, Boss melakukan animasi seperti mengambil telepon / mengirim notification.

Tidak ada audio dalam MVP.

---

## 70. 3D Office Style

Visual direction:

**Luxury Modern Trading Office**

dengan identitas:

**BYGA / BG**

Material:
- glass
- metal
- premium desk surfaces
- warm cinematic lighting
- professional market screens

Tidak terlalu sci-fi.

Style karakter:

**semi-stylized professional miniature**

---

## 71. Office Rooms

1. BYGA Lobby
2. Analyst Floor
3. Scanner Command Center
4. Market Wall
5. Risk Office
6. War Room / Meeting Room
7. Boss Office
8. Server/Data Room
9. Lounge / Pantry
10. Hallway / walking paths

---

## 72. Living Office State Machine

```text
MONITORING
↓
WATCHING
↓
TRIGGERED
↓
AI_ANALYSIS
↓
RISK_REVIEW
↓
BOSS_DECISION
↓
DISCORD
↓
RETURN_TO_DESK
↓
MONITORING
```

Tidak ada state DEBATE pada MVP.

---

## 73. Idle Office Behavior

Saat tidak ada case, Analyst dapat:
- mengetik
- melihat monitor
- berjalan pendek
- mengambil minum
- berinteraksi ringan dengan meja

Aktivitas dekoratif tidak memanggil AI.

---

## 74. WATCHING State

Jika hanya satu scanner menemukan setup atau trigger belum memenuhi minimum:
- Office → `WATCHING`
- relevant Analyst boleh terlihat aktif secara visual
- tidak ada AI API call

---

## 75. Character Movement

Karakter harus berjalan secara fisik antar area.

Tidak boleh teleport kecuali fallback teknis saat navigation path gagal.

Gunakan predefined navigation paths / waypoints agar lebih ringan dibanding full physics navigation.

---

## 76. Character Interaction

Tap/click karakter:
- nama
- role
- current status
- short live summary
- button `Lihat Detail`

Admin detail dapat menampilkan:
- role
- state
- latest analysis
- provider
- model
- fallback state
- vote
- confidence
- reasoning
- evidence
- warning
- history

---

## 77. Market Wall

Monitor dalam diorama menggunakan lightweight visual chart.

Saat Market Wall ditekan, buka real chart panel.

Timeframes:
- H1
- M15
- M5

Data berasal dari `chart_db`.

---

## 78. Scanner Command Center

Menampilkan enam scanner.

Setiap scanner menampilkan:
- BUY / SELL / NONE
- strength
- MTF state
- last scan time
- active/inactive state

Tap scanner membuka dedicated Scanner Detail Page.

---

## 79. Scanner Detail Page

Menampilkan:
- scanner name
- methodology
- current status
- H1 → M15 → M5
- indicators
- levels
- strength
- reasons
- candle timestamp
- configuration
- config version
- recent scan history

---

## 80. Server/Data Room

MVP hanya menunjukkan health sederhana:
- `chart_db`
- Trading Office API
- AI Providers
- Discord

AI Provider status utama:
- OK
- DEGRADED
- DOWN

Click panel membuka Admin detail per provider.

Circuit breaker detail Admin-only.

---

## 81. Camera

Default: isometric

User dapat:
- rotate terbatas
- pan
- zoom
- Reset View

Mobile:
- pinch zoom
- drag pan
- two-finger rotate

---

## 82. Portrait / Landscape

Portrait:
- default monitoring layout
- compact HUD
- bottom sheets
- simplified controls

Landscape:
- Expanded Office Mode

---

## 83. Adaptive 3D Quality

Full 3D tetap dipertahankan di mobile.

Pada device lemah turunkan:
- shadow resolution
- texture resolution
- anti-aliasing
- decorative animations
- particle count
- model LOD

Trading logic tidak dipengaruhi graphics quality.

---

## 84. Home 3D

Home (`/`) menampilkan kantor 3D pada seluruh viewport desktop dan mobile.
Navigasi halaman lain tersedia melalui menu overlay; panel market/scanner tersedia di `/operations`.
URL `/office` mengarah ke Home. Kamera overview, analis, dan meeting tetap tersedia.
Karakter dan kursi meeting memakai posisi serta arah duduk yang sama, menghadap meja.
Jika WebGL tidak tersedia, gunakan fallback operasi 2D yang tetap interaktif.

---

## 85. Public Viewer

Public dapat melihat:
- office 3D
- market status
- scanner status
- office activity
- meeting state
- speech summaries
- public signals jika enabled

---

## 86. Admin

Admin dapat mengakses:
- Settings
- AI Character config
- providers/models
- prompt configuration
- scanner configuration
- Trading Config Versions
- Discord
- Risk settings
- confidence weights
- Emergency Meeting
- Simulation
- provider diagnostics
- AI usage
- raw AI/debug information

---

## 87. Authentication

MVP menggunakan simple application password.

Password tidak pernah disimpan plaintext.

Session:
- HttpOnly
- Secure
- SameSite

Login harus memiliki rate limiting.

Tidak menggunakan Cloudflare Access untuk MVP.

---

## 88. Public Signals

Setting:

`Public Signals`

Jika ON:
- public dapat membuka signal page

Jika OFF:
- signal detail membutuhkan Admin login

Discord URL mengikuti setting ini.

---

## 89. Public Signal Content

Public signal menampilkan:
- BUY/SELL
- Entry Zone
- Preferred Entry
- TP
- SL
- R:R
- Confidence
- timestamp
- scanner composition
- AI vote composition
- H1/M15/M5
- flags
- Boss summary

Tidak menampilkan:
- system prompt
- full raw AI response
- provider debug
- API error details
- internal configuration
- secrets

---

## 90. Public Signal History

Configurable:

`Public Signal History`

Default ON.

Gunakan pagination.

Admin dapat mematikan atau membatasi jumlah histori.

Karena lifecycle belum ada, jangan menampilkan Win/Loss seolah telah diverifikasi.

---

## 91. Signals Page Filters

MVP mendukung:
- BUY / SELL
- date range
- Case ID
- Signal ID
- confidence range
- LOW_RR
- COUNTER_TREND
- AI_DEGRADED
- scanner trigger
- AUTO
- MANUAL / EMERGENCY
- LIVE

Simulation tidak muncul pada page ini.

---

## 92. AI Budget Controls

Advanced AI Budget Controls tersedia.

Admin dapat mengatur:
- max AI cases/day
- max estimated tokens/case
- max calls/case
- case cooldown
- Emergency limits
- Simulation limits

Default:

**unlimited / OFF**

---

## 93. Usage Dashboard

MVP hanya perlu:
- total AI calls today
- estimated tokens today

Counter reset:

**00:00 WIB**

Cost estimation USD tidak diperlukan di MVP.

---

## 94. AI Raw Response Storage

Structured AI output:
- permanent

Raw provider response:
- temporary
- Admin-only

Default retention:

**90 days**

Configurable.

API key/secrets harus di-redact.

---

## 95. Prompt Audit Storage

Permanen:
- prompt_version
- structured input snapshot

Temporary:
- rendered full prompt

Default retention:

**90 days**

Admin-only.

---

## 96. General Retention

Default detail retention:

**90 days**

Configurable.

Data permanen:
- Case summary
- Signal
- scanner result snapshots
- config versions
- prompt versions
- final AI votes
- Risk result
- Boss result

Large raw payloads mengikuti retention setting.

---

## 97. Price Precision

Gunakan **dynamic price precision** berdasarkan market/tick size/source metadata.

Jangan hard-code selalu 2 decimal.

---

## 98. Time Handling

Database:
- UTC

Display:
- WIB / Asia/Jakarta

Termasuk:
- UI
- Discord
- case timeline
- scanner time
- simulation
- human-readable IDs

---

## 99. Application Pages

```text
/office
/signals
/signals/:signalId
/cases
/cases/:caseId

/scanners
/scanners/trend
/scanners/breakout
/scanners/momentum
/scanners/mean-reversion
/scanners/structure
/scanners/liquidity

/characters
/characters/:characterId

/simulation
/simulation/history
/simulation/:simulationId

/admin
/admin/settings
/admin/providers
/admin/config
```

---

## 100. Database Concept

Recommended major entities:

```text
cases
signals
scanner_runs
scanner_outputs
ai_runs
ai_character_outputs
risk_runs
boss_decisions
trading_config_versions
prompt_versions
character_configs
provider_configs
simulation_runs
discord_deliveries
usage_daily
system_state
```

`chart_db` remains external/read-only.

---

## 101. Case Statuses

Recommended canonical statuses:

```text
QUEUED
REVALIDATING
WATCHING
TRIGGERED
AI_ANALYSIS
AI_DEGRADED
RISK_REVIEW
BOSS_REVIEW
SIGNAL_CREATED
NO_CONSENSUS
STALE
CANCELLED
DIRECTION_CHANGED
CONFIG_CHANGED
FAILED
COMPLETED
```

Status transition harus deterministic.

---

## 102. Concurrency Protection

Worker/orchestrator wajib menjamin:
- hanya satu live AI case aktif
- duplicate M5 candle tidak diproses
- duplicate Discord signal tidak dikirim
- Case/Signal sequence tidak collision
- retried HTTP requests tidak menciptakan signal ganda

Gunakan idempotency key berbasis:
- market
- candle timestamp
- workflow type

---

## 103. Failure Recovery

Jika Worker restart atau request terputus:
- case state harus bisa dilanjutkan dari persistent state
- jangan mengandalkan state browser sebagai source of truth
- UI hanya merefleksikan backend state

---

## 104. 3D / Backend Separation

3D office adalah representation layer.

Karakter tidak menjalankan trading logic di browser.

Browser menerima state seperti:

```text
ANALYST_1 = ANALYZING
RISK_MANAGER = WAITING
BOSS = IDLE
OFFICE = AI_ANALYSIS
```

lalu mengubahnya menjadi animation.

Backend tetap source of truth.

---

## 105. Public API

Siapkan REST API versioning sejak awal:

`/api/v1/...`

Endpoint public read-only dapat mencakup:

```text
GET /api/v1/market/status
GET /api/v1/scanners
GET /api/v1/office/state
GET /api/v1/signals
GET /api/v1/signals/:id
GET /api/v1/cases/:id/public
```

Admin endpoints membutuhkan authenticated session.

---

## 106. Realtime Updates

MVP sebaiknya menggunakan:
- Server-Sent Events jika stabil
- fallback short polling

WebSocket/Durable Object realtime dapat dipertimbangkan bila interaksi berkembang.

---

## 107. Performance Targets

Target:
- initial shell cepat tampil
- 3D asset lazy-loaded
- dashboard usable sebelum decorative assets selesai
- scanner status tidak menunggu 3D loading
- mobile interaction responsif

3D asset harus dioptimalkan:
- Draco/Meshopt jika sesuai
- compressed textures
- LOD
- instancing untuk repetitive props

---

## 108. Accessibility / Fallback

Jika WebGL gagal, tampilkan **2D Operations Dashboard fallback**.

User tetap dapat:
- melihat scanner
- melihat office state
- membuka signals
- menggunakan Admin

Trading system tidak boleh bergantung pada WebGL.

---

## 109. Security Requirements

Wajib:
- secrets server-side only
- no API key in JS bundle
- no webhook URL in client
- hashed Admin password
- secure session cookies
- CSRF-safe mutation approach
- login rate limiting
- validation for Admin input
- output encoding
- provider response sanitization
- strict API authorization
- chart_db read-only binding/permissions jika memungkinkan

---

## 110. Non-Goals MVP

Tidak termasuk:
- order execution
- exchange account connection
- automated trading
- position sizing berdasarkan wallet
- portfolio management
- signal Win/Loss tracking
- profit tracking
- backtesting engine penuh
- multi-symbol market
- audio
- voice AI
- multi-user roles
- Admin audit-log UI
- performance leaderboard
- self-learning AI memory

---

## 111. Phase 2 Candidates

Phase 2 dapat menambahkan:
- signal lifecycle tracking
- performance dashboard
- Win Rate
- Expectancy
- Profit Factor
- backtesting
- additional symbols
- additional exchanges
- funding
- Open Interest
- liquidations
- long/short ratio
- CVD/taker flow
- order book
- AI performance by model
- provider cost reporting
- Admin audit log
- agent memory
- strategy calibration

---

## 112. Final MVP Acceptance Criteria

MVP dianggap selesai ketika:

### Market Data
BTCUSDT H1/M15/M5 berhasil dibaca dari `chart_db` tanpa write operation.

### Scanner
Semua 6 deterministic scanners berjalan setiap closed M5 dan menghasilkan structured result.

### Trigger
AI Office hanya aktif sesuai scanner trigger rules.

### Queue
Satu case aktif dan queued case dapat direvalidate.

### AI
Enam Analyst berjalan parallel dengan provider/model configurable.

### Provider Reliability
Retry, fallback, timeout, circuit breaker, structured output, dan semantic validation berjalan.

### Voting
BUY/SELL/NO_TRADE voting bekerja sesuai specification.

### Risk
Entry Zone, midpoint Preferred Entry, SL, TP dan R:R dihasilkan.

### Risk Manager
Risk Manager mengevaluasi deterministic proposal.

### Boss
Boss memberikan final review dengan aturan authority yang ditentukan.

### Confidence
Final Confidence dihitung deterministic dari Scanner + AI + MTF.

### Signal
Signal tersimpan dengan immutable context, config version dan Case ID.

### Discord
Meeting Start dan Final Signal notifications berfungsi.

### Simulation
Historical simulation dapat menjalankan pipeline penuh secara terpisah dari Live.

### Emergency
Emergency Meeting berfungsi dan diberi label MANUAL / EMERGENCY.

### 3D Office
Living office menampilkan state backend secara visual dan karakter bergerak antar ruangan.

### Mobile
Portrait dan landscape dapat digunakan secara nyaman.

### Public/Admin
Permissions dan Public Signals berjalan sesuai Settings.

### Security
API keys tidak pernah terekspos ke client.

---

## 113. Recommended Build Order

### Milestone 1 — Core Foundation
Cloudflare project, D1 bindings, Admin authentication, chart_db reader, Trading Config Version.

### Milestone 2 — Deterministic Trading Engine
6 scanners, MTF engine, trigger engine, queue, cooldown, Risk Engine.

### Milestone 3 — AI Provider Layer
8 provider adapters, model discovery, structured output, validation, retries, fallback, circuit breaker.

### Milestone 4 — AI Trading Workflow
6 parallel Analysts, voting, Risk Manager, Boss, confidence engine.

### Milestone 5 — Persistence & Signals
Cases, signals, human-readable IDs, history, filters, public/private views.

### Milestone 6 — Discord
Meeting and Final Signal notification pipeline.

### Milestone 7 — 2D Operational UI
Admin, scanners, cases, signals, configuration, provider health.

### Milestone 8 — 3D Trading Office
Office model, rooms, characters, animations, HUD, Market Wall, Server Room, Home 3D layar penuh.

### Milestone 9 — Simulation & Emergency
Simulation replay, historical configs, Emergency Meeting.

### Milestone 10 — Hardening
Idempotency, degraded flows, responsive optimization, WebGL fallback, security review, production deployment.

---

## 114. Final Product Flow

```text
BTCUSDT candle closes
→ scanners inspect market
→ scanner consensus detects opportunity
→ Trading Office activates
→ six specialist AI analysts analyze independently in parallel
→ votes are counted
→ deterministic Risk Engine creates trade structure
→ Risk Manager evaluates it
→ Boss performs final review
→ deterministic confidence is calculated
→ signal is published
→ Discord is notified
→ office returns to monitoring
```

Seluruh pipeline harus mempertahankan catatan yang reproducible mengenai:
- data yang digunakan
- konfigurasi yang aktif
- provider/model yang menjawab
- hasil masing-masing komponen
- alasan final signal diterbitkan

---

## 115. Product Identity

**Product Name:** BYGA AI Trading Office

Suggested internal technical name:

`byga-trading-office`

Suggested tagline:

**AI Analysts. Deterministic Systems. One Trading Office.**

