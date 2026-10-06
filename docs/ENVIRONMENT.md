# Environment variables BYGA Office

Panduan untuk Worker produksi `byga-office`. Provider utama saat ini adalah **OpenRouter** (`openai/gpt-4.1-mini`), dengan fallback **Gemini** (`gemini-3.5-flash-lite`). Provider dan model diatur per karakter melalui Admin; tidak ada env khusus untuk nama model.

## 1. Secrets wajib di GitHub

Buka **Settings → Environments → production → Environment secrets**, lalu tambahkan empat secret berikut. Workflow staging menggunakan GitHub Environment `staging` dengan secrets miliknya sendiri.

| Nama | Isi | Kegunaan |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token API Cloudflare yang memiliki izin deployment Worker dan D1 pada akun tujuan | Deployment, migrasi aplikasi, dan validasi chart |
| `ADMIN_PASSWORD` | Password Admin minimal 12 karakter | Workflow membuat hash untuk login Admin |
| `OPENROUTER_API_KEY` | API key OpenRouter yang aktif dan memiliki kuota | Provider utama dan validasi inference nyata |
| `GEMINI_API_KEY` | API key Gemini yang aktif dan memiliki kuota | Provider fallback dan validasi inference nyata |

Contoh **placeholder**, bukan nilai yang bisa langsung dipakai:

```dotenv
CLOUDFLARE_API_TOKEN=<token-cloudflare>
ADMIN_PASSWORD=<password-admin-minimal-12-karakter>
OPENROUTER_API_KEY=<api-key-openrouter>
GEMINI_API_KEY=<api-key-gemini>
```

Tambahkan setiap secret secara terpisah. Kolom **Name** berisi nama env; kolom **Secret** hanya berisi nilainya, tanpa awalan `NAMA_ENV=`, tanda kutip, atau placeholder.

Token Cloudflare harus dibatasi ke akun tujuan. Rincian izin ada di [panduan deployment](DEPLOYMENT.md). Workflow memvalidasi kedua provider dengan panggilan nyata, sehingga key yang ada tetapi kuotanya habis tetap dapat menggagalkan deployment.

## 2. Secrets Discord opsional

Tambahkan pada GitHub Environment yang sama jika ingin mengaktifkan pengiriman Discord.

| Nama | Isi | Kegunaan |
| --- | --- | --- |
| `DISCORD_MEETING_WEBHOOK` | URL webhook Discord untuk meeting | Pengiriman hasil meeting |
| `DISCORD_SIGNAL_WEBHOOK` | URL webhook Discord untuk sinyal | Pengiriman sinyal final |

Deployment dapat berjalan tanpa kedua webhook di GitHub. Namun nilai GitHub yang kosong **tidak menghapus** secret runtime yang sudah ada di Cloudflare; workflow sengaja mempertahankan optional secret yang tidak dikirim. Karena itu status runtime Cloudflare adalah sumber kebenaran untuk binding yang masih terpasang. Hapus secret dari Cloudflare hanya setelah memastikan tidak dipakai oleh konfigurasi karakter/delivery aktif. URL webhook merupakan secret dan tidak boleh dimasukkan ke Markdown atau Git.

## 3. Secrets yang dipasang otomatis pada Worker

Workflow selalu memasang hash password Admin, OpenRouter, dan Gemini. Optional provider/webhook hanya di-update bila GitHub Environment menyediakan nilainya; jika kosong, binding Cloudflare yang sudah ada dipertahankan. Setelah pemasangan, workflow menjalankan `wrangler secret list` untuk menginventarisasi **nama/tipe** binding tanpa mencetak nilainya.

| Secret GitHub | Secret runtime Cloudflare |
| --- | --- |
| `ADMIN_PASSWORD` | `ADMIN_PASSWORD_HASH`, dibuat otomatis dengan PBKDF2-SHA256 |
| `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY` |
| `GEMINI_API_KEY` | `GEMINI_API_KEY` |
| `DISCORD_MEETING_WEBHOOK` | Nama yang sama, jika diisi |
| `DISCORD_SIGNAL_WEBHOOK` | Nama yang sama, jika diisi |
| `CLOUDFLARE_API_TOKEN` | Hanya dipakai alat deployment; tidak dipasang sebagai secret Worker |

Jika menggunakan workflow, tidak perlu membuat `ADMIN_PASSWORD_HASH` secara manual di GitHub. Worker membaca hash, bukan plaintext `ADMIN_PASSWORD`.

## 4. Variables konfigurasi deployment

Buka **Settings → Environments → production → Environment variables** untuk melakukan override. Ini adalah **Variables**, bukan Secrets.

Untuk target produksi saat ini, kelima nilai sudah tersedia di [deployment/production.json](../deployment/production.json). Variables kosong menggunakan nilai dari file tersebut; tidak perlu mengisinya ulang jika targetnya tetap sama.

| Nama variable GitHub | Default produksi | Kegunaan |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | `07086b4d368d0a37ebcbbf186e51eecf` | Akun Cloudflare tujuan |
| `BYGA_CHART_DB_ID` | `76f53f4c-a542-48a7-8eb8-10dbcba3c1aa` | ID D1 market `chart_db`, hanya dibaca oleh aplikasi |
| `BYGA_OFFICE_DB_ID` | `e787a5b2-c876-4afa-beae-55bb616504be` | ID D1 aplikasi `trading_office_db` |
| `BYGA_PUBLIC_ORIGIN` | `https://karyawanai.muidsoft.com` | Origin HTTPS untuk validasi request Admin |
| `BYGA_CHART_SCHEMA` | JSON schema berikut | Mapping kolom dan timeframe market |

Default `BYGA_CHART_SCHEMA`:

```json
{
  "table": "candles",
  "market": "symbol",
  "timeframe": "timeframe",
  "timestamp": "open_time",
  "open": "open",
  "high": "high",
  "low": "low",
  "close": "close",
  "volume": "volume",
  "closed": "is_closed",
  "timestampUnit": "milliseconds",
  "timeframeValues": {
    "H1": "H1",
    "M15": "M15",
    "M5": "M5"
  }
}
```

Jika mengisi override schema, masukkan JSON lengkap sebagai satu nilai variable. Origin harus tepat berupa origin HTTPS tanpa path atau trailing slash. ID database chart dan aplikasi harus berbeda; migrasi hanya diterapkan pada database aplikasi.

Untuk staging, sediakan konfigurasi target staging sendiri melalui variables di atas atau `deployment/staging.json`. Gunakan database aplikasi staging yang terpisah.

### Variables dan bindings runtime

Generator konfigurasi memasang nilai berikut; tidak perlu ditambahkan sebagai secrets:

| Nama | Sumber |
| --- | --- |
| `APP_ENV` | `production` atau `staging`, sesuai environment |
| `PUBLIC_ORIGIN` | `BYGA_PUBLIC_ORIGIN` atau default deployment |
| `CHART_SCHEMA` | JSON dari `BYGA_CHART_SCHEMA` atau default deployment |

`DB`, `CHART_DB`, `OFFICE`, dan `ASSETS` adalah bindings D1, Durable Object, dan assets di konfigurasi Wrangler. Jangan mengisinya sebagai secret teks.

`BYGA_ENV` dan `BYGA_DEPLOY_CONFIG` diatur otomatis oleh workflow. Untuk membuat konfigurasi secara lokal:

```sh
BYGA_ENV=production node scripts/configure.mjs
```

Hasilnya `.wrangler/deploy-production.json`. Generator juga mendukung `BYGA_R2_BUCKET` untuk binding opsional `OFFICE_ASSETS` saat dijalankan manual; variable ini belum diteruskan oleh workflow GitHub saat ini dan tidak wajib untuk deployment.

## 5. Konfigurasi development lokal

Worker lokal membaca `.dev.vars`. Buat dari template:

```sh
cp .env.example .dev.vars
npm run password:hash
```

Perintah hash meminta password dengan input tersembunyi, minimal 12 karakter. Tempel hasil hash pada `ADMIN_PASSWORD_HASH` di `.dev.vars`.

```dotenv
OPENROUTER_API_KEY=<api-key-openrouter>
GEMINI_API_KEY=<api-key-gemini>
ADMIN_PASSWORD_HASH=<hasil-npm-run-password:hash>

# Opsional jika ingin mencoba delivery Discord
DISCORD_MEETING_WEBHOOK=
DISCORD_SIGNAL_WEBHOOK=
```

Untuk eksplorasi lokal yang hanya membaca data, key AI dan webhook boleh kosong. Untuk panggilan nyata dengan konfigurasi provider saat ini, isi kedua key AI. Setup database dan frontend dijelaskan di [README](../README.md#local-development).

Jangan commit `.dev.vars` atau nilai secret. Jangan memasukkan key ke `VITE_*`, karena variable tersebut dapat masuk ke frontend.

## 6. Provider tambahan

Key berikut didukung oleh runtime, tetapi tidak wajib untuk kombinasi OpenRouter + Gemini:

| Nama | Provider |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI langsung |
| `GROQ_API_KEY` | Groq |
| `MISTRAL_API_KEY` | Mistral |
| `HF_TOKEN` | Hugging Face |
| `COHERE_API_KEY` | Cohere |
| `NVIDIA_API_KEY` | NVIDIA |

Workflow deployment menerima key provider tambahan tersebut dari GitHub Environment dan meng-update secret Worker bila nilainya tersedia. Jika nilainya tidak tersedia di GitHub, secret runtime Cloudflare yang sudah ada **tidak dihapus**, karena saved character config dapat masih menggunakannya. Untuk menonaktifkan provider, pindahkan karakter dari provider tersebut terlebih dahulu, verifikasi tidak ada penggunaan aktif, lalu hapus secret secara eksplisit di Cloudflare. Untuk lokal, tambahkan key di `.dev.vars`.

`OPENAI_API_KEY` tidak diperlukan untuk model `openai/gpt-4.1-mini` yang diakses melalui OpenRouter; model tersebut menggunakan `OPENROUTER_API_KEY`.

## 7. Status operasional

Cloudflare Workers AI tersedia sebagai provider `workers-ai` melalui binding `AI` di `wrangler.jsonc`. Tidak memerlukan API key AI tambahan di Worker. Pilih **Cloudflare Workers AI** pada primary atau fallback di Admin → AI Characters, lalu gunakan model Text Generation yang mendukung JSON Mode; model awal yang disarankan di UI adalah `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Discovery primary/fallback memuat katalog model dari binding. Test connection menjalankan probe JSON sintetis yang dibatasi, tanpa membuat sinyal. Request analisis memakai retry, circuit breaker, budget, dan audit yang sama dengan provider lain.

Binding AI menggunakan akun Cloudflare tujuan dan kuota Workers AI akun tersebut. Untuk pengembangan lokal, Workers AI memerlukan akses Cloudflare untuk inference; unit/integration tests menggunakan fixture dan tidak melakukan inference nyata. Deployment mempertahankan binding AI dari konfigurasi dasar dan smoke test memverifikasi binding dengan probe nyata melalui sesi Admin sementara. Pilihan karakter yang sudah tersimpan tidak diubah otomatis.

Status operasional terbaru (6 Oktober 2026): Cloudflare mengembalikan satu schedule aktif untuk `byga-office`, yaitu **`*/5 * * * *`**. Workflow deploy melakukan publish sementara tanpa cron, lalu selalu memulihkan schedule produksi setelah publish sementara berhasil, sehingga kegagalan smoke berikutnya tidak meninggalkan Worker tanpa trigger.

Health market dan endpoint status memakai `processingDelaySeconds` dari Trading Config aktif, sama dengan pipeline scanner. Final deployment smoke juga melakukan bounded retry atas status freshness yang sementara DOWN di sekitar pergantian candle; kegagalan yang persisten tetap memblokir acceptance. Cron tidak memerlukan env tambahan.

Deployment penuh dan acceptance keseluruhan belum selesai. Rincian hasil dan pekerjaan tersisa ada di [laporan acceptance produksi](PRODUCTION_ACCEPTANCE.md).

Sumber konfigurasi: [workflow deployment](../.github/workflows/deploy.yml), [generator konfigurasi](../scripts/configure.mjs), dan [interface env runtime](../src/server/env.ts).
