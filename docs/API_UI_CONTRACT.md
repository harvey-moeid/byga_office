# Sinkronisasi frontend dan backend — 10 Oktober 2026

Perbaikan ini menutup sembilan temuan backend (B1–B9) dan sembilan temuan frontend (F1–F9) dari audit workspace. Kode trading yang diperbaiki sebelumnya tetap dipertahankan. Pengujian menggunakan Worker/workerd dan D1 lokal terisolasi; perubahan belum diterapkan ke produksi.

Run GitHub PR #36 berikutnya menemukan race pada klik bubble Head Trader 3D desktop (86/87 lulus). Diagnosis, perbaikan harness dan batas validasi versi Chromium dicatat pada [regresi browser CI](CI_BROWSER_REGRESSION.md). Tabel validasi awal di bawah tetap mencatat hasil lokal sebelum follow-up tersebut.

## Kontrak dan alur UI

Frontend memakai URL relatif `/api/v1`, cookie `same-origin`, dan JSON untuk POST. Produksi menyajikan UI/API pada origin yang sama. Vite meneruskan `/api` ke `http://127.0.0.1:8787` secara default; `BYGA_API_URL` dapat mengganti target proxy di lingkungan pengembangan/pengujian. Variabel ini digunakan oleh konfigurasi Vite di server, bukan kredensial dalam bundle browser.

| Alur             | Endpoint dan metode                                                                                                     | Kontrak penting                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesi bersama     | `GET /auth/session`                                                                                                     | `{admin: boolean}`; pemeriksaan berkala 30 detik. 401 atau transisi Admin menjadi guest menghapus cache privat dan menutup route privat.                               |
| Login/logout     | `POST /auth/login`, `POST /auth/logout`                                                                                 | Form dikunci saat request; error terlihat. Logout ambigu memicu pemeriksaan ulang sesi.                                                                                |
| Office           | `GET /office/state`, `GET /office/events`                                                                               | DTO `OfficeState` yang sama, termasuk `observed_at`. SSE mempercepat polling, snapshot terbaru dipilih; error/unavailable membersihkan stream, TTL 15 detik.           |
| Config           | `GET/POST /admin/config`                                                                                                | Schema bersama `src/core/api.ts`; POST menyertakan `config`, `activation`, `confirmed`, `expectedVersion`, `idempotencyKey`. Hasil `{id, replacement_case_id}`.        |
| Scan             | `POST /admin/scan`                                                                                                      | Body `{}`; GET ditolak 405 dengan `Allow: POST`.                                                                                                                       |
| Emergency        | `POST /admin/emergency`                                                                                                 | `focus`, `sendDiscord`, `idempotencyKey`; 202 mengembalikan case, UI membuka `/cases/:id`.                                                                             |
| Simulation       | `POST /admin/simulation`                                                                                                | Cutoff WIB dikonversi ke epoch; `configMode`, `replayMode`, versi/case historical bila diperlukan, dan key stabil. Case dan metadata history ditulis dalam satu batch. |
| Case dan history | `GET /admin/cases/:id`, `GET /admin/simulation/:id`, `GET /admin/simulation/history`                                    | Cookie Admin tetap diperiksa backend; public case memakai `/cases/:id/public`.                                                                                         |
| Provider         | `GET /admin/providers`, `GET /admin/health`, `POST /admin/models`, `POST /admin/test-provider`, `POST /admin/providers` | Jaringan diagnostik berjalan di luar antrean mutasi; pembaruan cache/circuit tetap diserialkan. Health gagal ditampilkan UNKNOWN dengan retry.                         |
| Signal history   | `GET /signals`                                                                                                          | Page bilangan bulat 1–10000; date-only WIB memakai akhir hari untuk `to`, timestamp dengan timezone memakai cutoff persis. Rentang terbalik/invalid ditolak.           |

Semua mutasi Admin memerlukan sesi dan Origin yang sah. Metode yang tidak didukung ditolak; router tidak mengubah DELETE/GET menjadi POST. JSON dibaca dengan batas **200.000 byte aktual**, termasuk body streaming tanpa Content-Length. Root null/array/string dan JSON malformed mendapat 400; media tidak sesuai 415; body berlebih 413. Response melewati finalisasi header keamanan/rate-limit. Error internal umum tidak membocorkan SQL atau konfigurasi.

## Config, transaksi dan retry

APPLY NOW memerlukan konfirmasi. Market, replacement dan budget diperiksa sebelum perubahan disimpan. Batch transaksi mencakup versi config baru, jurnal hasil, pointer aktif, case pengganti, pembatalan case lama dan event. Constraint pada jurnal menolak commit jika pointer, status case atau quota berubah selama persiapan. Kegagalan market, quota atau bagian batch tidak meninggalkan konfigurasi/case setengah berubah.

`expectedVersion` menolak draft yang dibuat dari versi lama dengan 409 `CONFIG_CONFLICT`. Draft pengguna dipertahankan, refresh bersih menyinkronkan teks JSON, dan semua JSON/schema invalid mengunci Save. Tombol/form memiliki guard in-flight. Respons Save menampilkan versi tersimpan dan ID replacement bila ada.

UI menyimpan **key dan payload yang sama** dalam `sessionStorage` sebelum mengirim config, Emergency, atau Simulation. Saat timeout/koneksi terputus/5xx, tombol **Coba ulang permintaan** memakai operasi tersimpan, termasuk setelah reload. Hasil 2xx menghapus intent; penolakan 4xx menghapus intent hanya pada pengiriman pertama yang hasilnya pasti. Bila percobaan sebelumnya ambigu, penolakan saat retry (termasuk 401 ketika sesi berakhir) tidak membuktikan bahwa operasi lama gagal commit, sehingga intent tetap disimpan sampai berhasil direkonsiliasi atau pengguna memilih membuat permintaan baru. Pemakaian key sama dengan payload berbeda ditolak 409 `IDEMPOTENCY_CONFLICT` oleh backend. Emergency/Simulation memeriksa case yang sudah commit sebelum membaca ulang market; history Simulation ikut commit atomik.

Config menyimpan hasil commit dalam `admin_operations`; retry mengembalikan hasil tersebut, bukan membuat versi/replacement lagi. Case yang berhasil commit tetapi alarm gagal dipasang dapat dibangunkan oleh retry, pemulihan actor atau cron. Gap pada nomor urut setelah persiapan gagal diperbolehkan; ID tidak dipakai ulang.

**Buat permintaan baru** memerlukan konfirmasi UI karena operasi lama mungkin sudah diterima server. Intent bertahan ketika sesi berakhir agar dapat direkonsiliasi setelah login, sepanjang tab yang sama masih memiliki sessionStorage. Intent tidak menyimpan password/token/provider key. Bila browser memblokir penyimpanan, retry masih aman dalam mount yang sama; ketahanan setelah reload tidak tersedia. Menutup tab/menghapus storage menghilangkan jurnal client. Jurnal server belum memiliki kebijakan pruning, agar deduplikasi tidak hilang diam-diam.

`expectedVersion` dan config `idempotencyKey` tetap opsional untuk client legacy; UI baru selalu mengirim keduanya. Client lama yang tidak mengirim key tidak memperoleh perlindungan deduplikasi config, dan tanpa expectedVersion tidak mendeteksi stale draft. Perilaku legacy ini tidak mengurangi atomicity APPLY NOW.

## Publikasi dan status yang terlihat

Saat Public Signals OFF, pengguna anonim tetap dapat melihat vote/confidence/status, tetapi level entry/SL/TP, evidence/risk flags bebas dan narasi AI privat pada meeting, public case dan history karakter dirahasiakan. Ringkasan privat diganti dengan **“Detail analisis dirahasiakan karena Public Signals OFF.”** Seluruh narasi AI disamarkan, karena harga dapat ditulis sebagai kata atau diulang dalam reasoning; regex angka saja tidak cukup. `prices_private` pada meeting menjelaskan proyeksinya. Admin dan publik ketika toggle ON menerima proyeksi yang sesuai. Harga pasar dari candle publik tetap tersedia.

Public state/SSE mengembalikan kategori `MARKET_UNAVAILABLE`, bukan raw error D1. Detail teknis hanya tersedia melalui health Admin. Tim AI menampilkan LOADING/UNKNOWN saat datanya belum ada atau gagal. Provider tidak menganggap pemeriksaan gagal sebagai secret/binding missing. Modal karakter menggunakan native dialog dengan nama aksesibel, fokus awal, penguncian Tab, Escape dan pemulihan fokus. Navigasi mobile dapat digulir horizontal dan membawa item yang difokuskan ke area terlihat.

## Penutupan temuan dan bukti

| Temuan | Perbaikan                                                      | Regresi                                                                                                                                                                     |
| ------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1     | Proyeksi privat konsisten pada tiga endpoint, termasuk teks AI | API hardening; browser ke Worker: anonymous/Admin × OFF/ON                                                                                                                  |
| B2     | Allowlist metode, Origin, forward metode persis                | 34 kombinasi unauthenticated; GET scan, DELETE config, Origin salah; scan UI asli                                                                                           |
| B3     | Preflight + commit D1 atomik + receipt idempoten               | Quota, chart failure, trigger kegagalan di dalam batch, success/retry; APPLY NOW melalui UI asli                                                                            |
| B4     | Batas byte aktual untuk streaming dan UTF-8                    | Stream tanpa length, multibyte oversized, batas persis 200.000 byte                                                                                                         |
| B5     | DTO state/SSE sama dan sanitasi error                          | Chart fault: state dan frame SSE; raw detail hanya pada Admin                                                                                                               |
| B6     | Diagnostik provider di luar queue                              | Provider sengaja ditahan sementara state dan config tetap selesai                                                                                                           |
| B7     | Validasi page integer/range                                    | Pecahan, nol, overflow, nonangka, Infinity                                                                                                                                  |
| B8     | Cutoff timestamp persis, date-only WIB, range validation       | Signal sesudah cutoff tidak masuk; end-of-day masuk; invalid/terbalik ditolak                                                                                               |
| B9     | Parser/root/schema dan finalisasi response bersama             | Malformed/null/array/string, media, status/header konsisten                                                                                                                 |
| F1     | Freshness timestamp, error handlers dan TTL SSE                | Stream lama diganti polling baru; error polling terlihat                                                                                                                    |
| F2     | Intent/key/payload stabil dan persistensi tab                  | Emergency/Simulation/config response sengaja diputus setelah commit nyata; reload, retry 401 dan login ulang tetap satu operasi; penolakan 4xx retry tidak menghapus intent |
| F3     | Sinkronisasi JSON, dirty/conflict dan agregasi validitas       | Refresh bersih, JSON invalid, draft konflik, reload versi dan payload yang terlihat                                                                                         |
| F4     | Guard in-flight, form disabled, receipt config                 | Config tertahan tidak bisa disubmit ulang; APPLY NOW dengan key sama tidak berulang                                                                                         |
| F5     | Typed 401, session context dan invalidasi cache/modal          | Cache case privat hilang, detail meeting terbuka ditutup, route kembali ke login; login/logout Worker asli                                                                  |
| F6     | Native dialog dan keyboard/focus lifecycle                     | Shift+Tab/Tab, Escape dan restore opener                                                                                                                                    |
| F7     | Nav mobile scrollable/focus visible                            | Lebar 320px dan batas dokumen; toleransi maksimum 1px untuk pembulatan scroll Chromium                                                                                      |
| F8     | LOADING/UNKNOWN/error terpisah dari hasil terkonfirmasi        | Office/health 503 tidak menghasilkan MONITORING/Secret missing palsu                                                                                                        |
| F9     | Logout catch, feedback dan rekonsiliasi sesi                   | Logout 503 tampil sebagai alert tanpa unhandled promise; logout nyata kembali guest                                                                                         |

Jalankan dari root repository:

```bash
npm run typecheck
npm run lint
npm test
BYGA_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser -- --workers=1
BYGA_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser:integration
npm run build
npm run deploy:check
npm run security:audit
```

Pada mesin dengan Chromium Playwright terpasang, variabel executable dapat dihilangkan. CI dan workflow deployment kini menjalankan kedua suite browser sebelum penerapan migration atau publikasi Worker. Timeout deployment menjadi 30 menit untuk menampung suite tambahan.

`tests/api-hardening.test.ts` memakai auth, router, Office dan D1 workerd sebenarnya dengan fixture chart dan fault injection. `browser-tests/api-sync.spec.ts` memakai API/EventSource terkendali untuk race dan error frontend. `browser-integration/api.spec.ts` memakai browser, Vite proxy, cookie, Worker, DO dan D1 sebenarnya pada port 5175/8788. Hanya response yang sengaja diputus untuk menguji rekonsiliasi; commit backend tetap nyata di database lokal.

Suite browser integrasi menonaktifkan alarm AI melalui subclass khusus test dan menolak seluruh outbound provider/Discord. Ia memverifikasi queueing, kontrak dan database, bukan inference/delivery produksi. Pipeline dan delivery tetap diuji oleh suite integrasi terpisah dengan provider fixture. Endpoint kontrol fixture hanya berada pada bridge Node localhost, tidak terdapat pada bundle Worker produksi.

## Hasil validasi akhir

| Pemeriksaan                               | Hasil                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| TypeScript dan ESLint                     | Lulus                                                                                                                        |
| Unit/backend/workerd/D1                   | **267/267 lulus**, 16 suite; full run terakhir 88,69 detik                                                                   |
| Suite browser penuh saat finalisasi       | **87/87 lulus dalam satu run**, desktop + mobile portrait + landscape; 6,0 menit; tidak ada gagal atau skip                  |
| Regresi UI dan retry pada finalisasi      | **30/30 lulus**; mencakup penolakan 4xx saat rekonsiliasi, modal privat, sesi dan error frontend                             |
| Browser terhubung ke Worker/D1            | **18/18 lulus**; 6 alur × 3 viewport; finalisasi 1,3 menit, termasuk retry 401 dan login ulang setelah commit nyata          |
| Build frontend dan Worker dry-run         | Lulus; dry-run tidak memublikasikan Worker                                                                                   |
| Dependency audit produksi dan keseluruhan | **0 vulnerability** pada kedua pemeriksaan                                                                                   |
| Migration keenam                          | Diterapkan dan diverifikasi pada D1 lokal                                                                                    |
| Koneksi pengembangan                      | GET session/state melalui Vite proxy lulus; Worker HTML, characters dan market fixture lulus; Admin tanpa cookie ditolak 401 |

Dua masalah harness backend ditemukan dan diperbaiki selama verifikasi: request JSON pada tes trading lama belum mengirim Content-Type, dan fixture integrasi dapat berpindah candle saat jam nyata melewati batas lima menit. Header request kini sesuai kontrak. Cadence fixture integrasi diikat pada waktu awal fixture agar tes pembatalan tidak berubah menjadi tes candle baru secara acak. Assertion keselamatan tidak dilonggarkan; penolakan candle yang berubah tetap diuji secara terpisah dalam trading-safety.

Pada finalisasi, identitas operasi ambigu diperkuat agar tidak hilang ketika retry ditolak 4xx. Tes browser terkendali memverifikasi 400/409, sedangkan tes Worker asli menghapus cookie tepat ketika retry dikirim dan memverifikasi 401, login ulang, payload/key identik dan satu record server. Locator status dibuat spesifik karena notice intent dan pesan hasil sama-sama memakai role status. ESLint kini mengabaikan direktori artefak Playwright agar pengujian browser yang membersihkan output tidak mengganggu lint paralel. YAML ketiga workflow berhasil diparse; workflow GitHub baru belum dieksekusi secara remote.

Instruksi `start_skill` cloud diperbarui dan tersimpan sebagai **draft**, mempertahankan instruksi instalasi dan kebutuhan kredensial yang sudah ada. Draft menambahkan suite browser–API terisolasi serta verifikasi proxy. Untuk dipakai pada tugas cloud berikutnya, review/save pengaturan lingkungan lalu Publish; penyimpanan draft ini tidak melakukan deployment aplikasi atau membuktikan restorasi pada mesin baru.

Bundle frontend production juga dibuka langsung dari Worker lokal pada route Operations: halaman Trading Office dan status MONITORING tampil, request market 200, tanpa JavaScript error atau alert. UI/API pengembangan dijalankan dengan `--local`; Admin pada lingkungan utama tetap memerlukan hash password pengguna, berbeda dari kredensial fixture test terisolasi.

## Migration dan batas penerapan

Migration **`0006_admin_operations.sql`** menambah jurnal idempotensi dan telah diterapkan ke D1 lokal. Kelima migration lama tetap utuh. Environment staging/produksi harus menerapkan migration keenam ke **database aplikasi** sebelum source baru dipakai; jangan menerapkannya ke database chart. Ikuti proses environment/deployment yang sudah ada di `docs/DEPLOYMENT.md`.

Tidak ada deployment atau mutation pada database produksi dalam pekerjaan ini. Binding, cookie di HTTPS/proxy produksi, latensi provider, inference/delivery nyata dan performa perangkat fisik belum diverifikasi oleh suite lokal ini. Scene 3D tetap memiliki chunk besar dan software WebGL sensitif terhadap timing; pengujian mobile di Chromium adalah emulasi. Hasil lokal tidak merupakan jaminan profit trading atau bahwa seluruh kemungkinan bug sudah ditemukan.
