# Nama avatar, histori, dan strategi scanner

Login Admin diperlukan untuk perubahan berikut.

## Nama avatar

Buka **Admin → AI Characters**, pilih karakter, isi **Nama avatar**, lalu **Save character & prompt**. Maksimal 60 karakter; kosongkan untuk menggunakan nama peran bawaan. Nama muncul di kartu tim, detail karakter, dan percakapan kantor. ID internal serta tugas analis tidak berubah. Pengaturan lama tetap dapat dibaca tanpa migrasi karakter.

## Hapus histori

Tombol **Hapus histori selesai** tersedia di Cases, Signals, dan Simulation History. Cases/Signals menghapus histori LIVE; Simulation History menghapus histori SIMULATION. Dialog meminta konfirmasi. Hanya case terminal yang dibuat sebelum tombol ditekan yang dihapus dari daftar, detail, histori karakter, dan percakapan. Case aktif tetap tersedia.

Penghapusan menggunakan penanda di `history_deletions`: catatan analisis, idempotensi, cooldown, kuota, dan pengiriman Discord tetap tersimpan untuk operasional/audit. Ini bukan penghapusan fisik seluruh catatan database. Tidak menghapus konfigurasi atau prompt. Permintaan berulang tidak menggandakan penghapusan.

Migrasi `0009_history_deletions.sql` diperlukan. Untuk pengembangan lokal jalankan `npm run db:migrate`; deployment produksi harus menerapkan migrasi sebelum Worker baru.

## Strategi scanner

Buka **Scanners → Edit strategi scanner** atau **Admin → Trading Config**.

- **Parameter scanner** mengatur periode EMA, RSI, ADX, volume, Bollinger, dan struktur.
- **Aturan BUY / SELL** menyediakan mode bawaan, kustom, atau nonaktif untuk setiap scanner.
- Kustom memiliki sisi BUY dan SELL terpisah, masing-masing 1–12 kondisi. Pilih ALL (semua) atau ANY (salah satu).
- Bandingkan indikator H1/M15/M5 dengan angka atau indikator timeframe lain. Arah bias/struktur dibandingkan dengan BUY, SELL, NONE menggunakan `==` atau `!=`.
- Jika BUY dan SELL sama-sama cocok, hasil NONE. Data pembanding yang hilang/non-finite tidak memenuhi kondisi. Input tidak menjalankan JavaScript atau kode bebas.
- Nama metrik `ema20`, `ema50`, `ema200` mengikuti periode cepat, menengah, dan lambat yang dikonfigurasi. `previousClose` adalah close candle sebelumnya; `displacementAtr` adalah nilai absolut body / ATR.

Contoh: momentum BUY saat `M5.rsi >= 60` dan `M5.volumeRatio >= 1.2`; SELL saat `M5.rsi <= 40` dan `M5.volumeRatio >= 1.2`. Tambahkan kondisi menggunakan tombol di sisi masing-masing.

Simpan dengan **Save new version**. **NEXT CASE** berlaku untuk case baru; **APPLY NOW** memakai alur konfirmasi pembatalan/penggantian case yang sudah ada. Versi lama tetap immutable dan replay historis tetap memakai snapshot lama. Tanpa `scannerRules`, keenam scanner memakai perilaku bawaan. Grup konsensus, validasi risiko, dan batas operasional tetap berlaku setelah aturan kustom.
