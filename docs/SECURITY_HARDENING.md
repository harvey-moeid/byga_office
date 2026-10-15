# Penguatan publikasi dan deployment

## Kebijakan sinyal

Office baru memakai `publicationPolicy`: kuorum AI searah minimal separuh analis (minimal dua), Risk Manager dan Head Trader harus memberi output SUCCESS searah, confidence minimal 60, dan R:R minimal `minRR`. Output hilang, NO_TRADE, berlawanan, atau invalid tidak menjadi persetujuan. Case yang tidak memenuhi kebijakan berakhir NO_CONSENSUS dengan alasan publik, tanpa menulis atau mengirim sinyal.

Admin → Trading Config menampilkan kelima kontrol ini, tombol **Gunakan kebijakan ketat**, dan Activation yang sama dengan parameter lainnya. Menonaktifkan suatu kontrol mengurangi pembatasan itu; keputusan tersebut tercatat di versi konfigurasi immutable.

Migrasi `0010_strict_publication_policy.sql` mengaktifkan kebijakan ketat melalui **versi baru** untuk konfigurasi aktif yang belum memiliki kebijakan. Konfigurasi/case historis dan case yang sudah mengantre tidak ditulis ulang. Replay lama tetap mengikuti snapshot lama; audit/reproduksi hasil lama tetap mungkin. Migrasi tidak mengganti kebijakan yang sudah ditentukan Admin.

## Data publik

- Public Signals OFF: snapshot scanner/state/SSE kehilangan indikator, level harga, payload grup, serta narasi bebas yang dapat menyebut harga. Vote/status dan aktivitas visual tetap tersedia.
- Percakapan AI maupun scanner menggunakan proyeksi privat yang sama. Payload grup percakapan dipilih berdasarkan allowlist field.
- Candle dan detail harga dari `/market/status` dan `/market/candles` memerlukan sesi Admin ketika Public Signals OFF. Chart publik tersedia saat Public Signals ON.
- Public History OFF menutup daftar dan akses detail melalui ID, termasuk histori karakter. `historyLimit` berlaku secara global untuk ID sinyal/case yang boleh dibaca anonim. Meeting terkini tetap bisa diputar; permintaan meeting historis mengikuti batas histori.
- Admin tetap dapat membaca data operasional. Penanda penghapusan histori tetap dihormati.
- Koneksi SSE berakhir setelah paling lama sekitar lima menit lalu EventSource dapat tersambung ulang. Izin publik dan sesi diperiksa kembali saat pembaruan.

## Header dan CI

`public/_headers` memasang CSP, X-Frame-Options DENY, nosniff, dan Referrer-Policy pada HTML/aset SPA. CSP memperbolehkan `wasm-unsafe-eval` untuk decoder avatar serta `data:`/`blob:` pada connect-src untuk loader three.js; tidak memperbolehkan eval JavaScript umum atau host eksternal. Smoke deployment memeriksa header HTML sebenarnya, sehingga proteksi yang hanya ada di API tidak dianggap cukup.

Secret GitHub Actions dibatasi pada env step pemakainya. `npm ci --ignore-scripts` dan pemeriksaan source berjalan tanpa secret deployment. Instalasi bersih diverifikasi dengan esbuild dan sharp. Cron hanya diaktifkan setelah deployment awal dan smoke lulus; kegagalan awal menyisakan cron nonaktif untuk investigasi, tanpa mengklaim rollback otomatis. Custom domain menonaktifkan workers.dev agar tidak ada host alternatif tanpa sengaja.

Kegagalan validasi semantik AI tetap tercatat dan tidak ikut voting, tetapi respons provider yang berhasil secara transport tidak lagi membuka outage circuit breaker. Aplikasi juga memiliki error boundary tingkat atas dan formatter waktu menolak timestamp invalid.

## Batas pekerjaan ini

Perubahan ini menangani empat prioritas audit utama dan beberapa perbaikan terkait. Belum menambahkan retensi menyeluruh, pembatasan biaya default baru, deadline total case, cache data pasar, perubahan toleransi gap candle, atau pelacakan hasil TP/SL. Tidak mengubah produksi langsung; verifikasi proteksi GitHub Environment dan scope token tetap perlu akses operasional yang sesuai.
