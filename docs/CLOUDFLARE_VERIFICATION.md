# Pemeriksaan Cloudflare BYGA — 4 Oktober 2026 (UTC)

Laporan historis: pengamatan di bawah berasal dari 4 Oktober. Jadwal lima menit berikutnya tercatat di [Deployment](DEPLOYMENT.md). Perbaikan trading serta UI/API pada 10 Oktober hanya diverifikasi lokal, belum diterapkan ke produksi; lihat [kontrak dan hasil validasi UI/API](API_UI_CONTRACT.md). Migration `0006_admin_operations.sql` belum diterapkan remote dalam pekerjaan ini.

Account ID: `07086b4d368d0a37ebcbbf186e51eecf`.

## Hasil produksi setelah pergantian provider

Worker `byga-office` sudah terbit di https://byga-office.harveymoeid.workers.dev. Pada deployment 37184871525, OpenRouter `openai/gpt-4.1-mini` dan Gemini `gemini-3.5-flash-lite` lolos discovery/inferensi nyata; frontend, binding D1, Durable Object, login Admin, cookie, penolakan origin, dan logout lolos smoke test. Delapan konfigurasi karakter tersimpan dengan OpenRouter utama dan Gemini fallback. Nama kedua secret runtime terkonfirmasi tanpa membuka nilainya.

Pada pemeriksaan berikutnya, 07:31:02 UTC (14:31:02 WIB), PUT schedules untuk `byga-office` berhasil dengan HTTP 200 dan GET mengonfirmasi cron `* * * * *`, sesuai `wrangler.jsonc`. Hambatan konfigurasi 10072 sebelumnya sudah teratasi untuk jadwal ini. Tidak ada cron Worker lain yang diubah/dihapus atau paket akun diubah oleh tindakan ini. Pada 07:34:17 UTC, office melaporkan `Stale M5 data` tanpa pemanggilan scan manual dalam pemeriksaan ini. SELECT chart menunjukkan candle M5 tertutup terakhir memiliki open 07:20 UTC (close 07:25 UTC); audit scanner masih kosong. Jadwal telah mencapai guard freshness, tetapi scan sukses berulang belum diterima. Tidak ada data chart ditulis atau guard freshness dilonggarkan. Lihat [laporan penerimaan terbaru](PRODUCTION_ACCEPTANCE.md).

## Hasil deployment sebelum pergantian provider

Ketiga secret wajib GitHub produksi sudah tersedia. Token Cloudflare yang dipakai workflow berhasil menjalankan reader aplikasi nyata melalui API D1 pada 06:34 dan 06:41 UTC: 260 candle tertutup per H1/M15/M5 lolos OHLC, gap, dan freshness. Seluruh query chart SELECT-only. Ini membuktikan akses baca D1, belum membuktikan izin deploy Worker.

CI terbaru 37183388465 lolos 109 tes unit/integrasi dan 30 tes browser. Deployment 37183388460 berhenti pada inferensi OpenAI HTTP 429 dengan tipe `insufficient_quota`; model discovery berhasil. Worker BYGA tetap belum ada dan pemeriksaan endpoint produksi belum dijalankan. Pulihkan billing/kuota proyek pemilik API key lalu rerun deployment. Lihat [laporan penerimaan produksi](PRODUCTION_ACCEPTANCE.md).

## Pembaruan setup produksi

Akses akun `07086b4d368d0a37ebcbbf186e51eecf`, Workers subdomain `harveymoeid`, dan kedua D1 kembali berhasil diperiksa. Worker BYGA belum ada pada pemeriksaan ini.

Lima migrasi 0001–0005 sudah diterapkan ke `trading_office_db` dan tercatat dalam `d1_migrations`. Terdapat 22 tabel aplikasi, selain ledger dan tabel internal. Migrasi tidak dijalankan ke `chart_db`.

260 candle tertutup terbaru per H1/M15/M5 mempunyai nol gap dan nol baris OHLC/volume tidak valid. Snapshot di sekitar pergantian candle menunjukkan freshness dapat gagal pada toleransi lima detik; validasi predeploy memakai reader aplikasi yang sama dan wajib lolos, bukan mengabaikan candle yang tertinggal. Tick size instrumen belum mendapat verifikasi exchange; jangan menganggap presisi tampilan sebagai verifikasi tick size.

Konfigurasi produksi nyata disimpan di `deployment/production.json`, menargetkan `https://byga-office.harveymoeid.workers.dev`. Credential deployment, Admin dan OpenAI wajib tersedia sebelum workflow dapat menerbitkan Worker.

Laporan di bawah ini adalah pemeriksaan awal sebelum migrasi:

Pemeriksaan remote awal menggunakan konektor Cloudflare: GET metadata kedua database dan SELECT schema/data agregat. Saat itu tidak ada migrasi, seed, deployment, atau perubahan database.

| Database | ID | Hasil |
| --- | --- | --- |
| chart_db | 76f53f4c-a542-48a7-8eb8-10dbcba3c1aa | GET dan SELECT berhasil; ukuran snapshot 3.301.376 byte; region APAC |
| trading_office_db | e787a5b2-c876-4afa-beae-55bb616504be | GET dan SELECT berhasil; hanya tabel internal _cf_KV, belum ada tabel aplikasi/migrasi; ukuran 12.288 byte |

Semua SELECT yang dijalankan melaporkan `rows_written=0`, `changes=0`, dan `changed_db=false`. Angka metadata `num_tables` tidak dipakai sebagai sumber jumlah tabel; daftar diperiksa melalui `sqlite_schema`.

## Token dan akses

Runtime environment melaporkan `CLOUDFLARE_API_TOKEN` berstatus `ready` dan network policy `enforced` untuk api.cloudflare.com. Status tersebut bukan verifikasi otorisasi API.

Verifikasi token environment belum selesai: permintaan shell tanpa tambahan akses jaringan gagal dengan `Operation not permitted`; permintaan akses tambahan terhenti sebelum respons API. Nilai token tidak dicetak/disimpan.

Pada konektor Cloudflare, GET /user/tokens/verify dan GET /accounts/{account_id}/tokens/verify mengembalikan error 1000 `Invalid API Token`, sedangkan akses kedua database dan SELECT berhasil. Hasil konektor tidak membuktikan validitas/invaliditas token environment BYGA, dan alasan perbedaan respons belum diketahui.

## Schema chart_db

Tabel: candles, candle_stats, ingest_runs, pair_ingest_state, d1_migrations, dan tabel internal _cf_KV.

`candles`: id INTEGER PRIMARY KEY AUTOINCREMENT; symbol TEXT NOT NULL; timeframe TEXT NOT NULL; open_time INTEGER NOT NULL; open/high/low/close/volume REAL NOT NULL; created_at INTEGER DEFAULT unixepoch(); source TEXT NOT NULL DEFAULT 'bybit'; is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0,1)).

Unique index: `idx_candles_unique(symbol, timeframe, open_time)`. Index tambahan: `idx_ingest_runs_created(id DESC)`. Trigger INSERT/DELETE pada candles memperbarui candle_stats.

Mapping yang teramati (belum diterapkan ke config deployment):

```json
{"table":"candles","market":"symbol","timeframe":"timeframe","timestamp":"open_time","open":"open","high":"high","low":"low","close":"close","volume":"volume","closed":"is_closed","timestampUnit":"milliseconds","timeframeValues":{"H1":"H1","M15":"M15","M5":"M5"}}
```

Unit milidetik didukung oleh nilai open_time berukuran 13 digit pada data yang dibaca. Tick size belum diverifikasi.

| BTCUSDT timeframe | Total snapshot | is_closed=1 | Sumber |
| --- | ---: | ---: | --- |
| H1 | 792 | 791 | bybit |
| M15 | 1631 | 1630 | bybit,okx_swap |
| M5 | 4891 | 4890 | bybit,okx_swap |
| H4 | 216 | 215 | bybit |
| D1 | 369 | 368 | bybit |

Ini snapshot, bukan jaminan freshness/gap atau kualitas candle. Reader aplikasi kini mendukung `closed: "is_closed"` untuk menyaring flag tersebut, sekaligus cutoff waktu. Unit test query lulus; integrasi schema nyata memakai fixture lokal tersedia tetapi belum dijalankan karena sandbox. Freshness/gap remote belum mendapat live acceptance. Config lokal masih memakai placeholder dan timestamp kolom `timestamp`, sehingga belum cocok dengan schema remote.

## Setup yang masih terbuka

Verifikasi token environment melalui API; tentukan staging/production dan HTTPS origin; siapkan config deployment dengan ID/mapping terverifikasi; periksa flag closed, freshness/gap dan tick size; migrasi hanya trading_office_db bila masuk lingkup setup berikutnya; siapkan secret aplikasi dan validasi deployment. Tidak ada langkah tersebut yang dijalankan pada pemeriksaan ini.

