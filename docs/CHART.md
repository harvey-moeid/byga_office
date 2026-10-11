# Halaman Chart

Menu **Chart** membuka `/chart`, dengan candlestick BTCUSDT.P dan volume asli tanpa indikator, sinyal overlay, atau panggilan AI. Pilihan M5, M15, dan H1 tersimpan dalam URL (`/chart?timeframe=M15`). Waktu sumbu dan crosshair memakai WIB. Geser riwayat, gunakan scroll/cubit untuk zoom, atau tekan **Ke candle terbaru**.

Modul Chart dan TradingView Lightweight Charts 5.2.1 dimuat hanya saat rute dibuka. Berpindah dari Office melepas renderer 3D beserta polling dan stream Office. Chart menggunakan canvas 2D, dua seri (harga dan volume), resize observer, dan pembaruan data tanpa loop animasi aplikasi. Pemberitahuan atribusi TradingView dan tautan pembuat tampil di bawah grafik.

Awalnya UI meminta maksimal 500 candle pada satu timeframe. Riwayat pendek tetap ditampilkan, dengan batas memori 1000 candle. Polling setiap 30 detik mengirim cursor candle terakhir; hanya candle baru yang ditambahkan. Tidak ada pemuatan riwayat tak terbatas. Jika lebih dari 500 candle tertinggal, UI mengambil satu snapshot terbaru. Polling dan permintaan aktif dihentikan saat tab tersembunyi, offline, atau rute ditinggalkan. Koneksi pulih melanjutkan pembaruan.

Grafik memakai candle yang sudah ditutup dan melewati processing delay konfigurasi aktif, bukan harga realtime candle berjalan. Data terlambat diberi **STALE**, riwayat kosong diberi **EMPTY**, dan kegagalan pembaruan mempertahankan grafik dengan **UNKNOWN** serta tombol retry. Jeda antar candle ditandai; tidak ada harga atau candle buatan untuk menutup kekosongan. Lingkungan development diberi label fixture.

## API

`GET /api/v1/market/candles?timeframe=M5&limit=500&after=1791676500000`

- `timeframe`: M5 (default), M15, atau H1.
- `limit`: bilangan bulat 10–1000; default 500.
- `after`: optional, UTC milidetik, eksklusif; tanpa cursor mengambil candle terbaru lalu mengurutkan kronologis. Dengan cursor mengambil bar setelah timestamp tersebut secara ascending, sehingga tidak melewatkan backlog.
- Parameter tidak dikenal, duplikat, angka tidak valid, dan timestamp masa depan ditolak dengan 400. Selain GET ditolak dengan 405. Endpoint memakai pembatasan permintaan API yang ada.

Respons memuat `market`, `timeframe`, `candles` (timestamp milidetik, OHLCV), `latest_timestamp`, `observed_at`, `status`, `has_more`, `gap_count`, `tickSize`, dan `development`. `has_more` menandai delta melebihi batas; `gap_count` menghitung jeda di batch yang dikembalikan. Poll tanpa candle baru tetap memuat timestamp candle terbaru dan status freshness. Gangguan database, schema, atau konfigurasi menghasilkan 503 dengan `CHART_UNAVAILABLE`.

Endpoint publik mengikuti akses data pasar pada `/market/status`. Endpoint hanya menyajikan OHLCV dari market tetap BTCUSDT; tidak menyajikan analisis privat, entry/SL/TP, provider, atau konfigurasi Admin. Data diambil dengan SELECT dari CHART_DB melalui CHART_SCHEMA yang sama; identifier tervalidasi dan nilai parameter di-bind. Tidak ada perubahan database chart, migrasi baru, inferensi AI, atau pengiriman Discord. Reader trading tetap menolak riwayat yang tidak cukup, berlubang, atau stale.

Validasi mencakup unit query/reader/merge, router Worker dengan D1, render canvas desktop/portrait/landscape, navigasi lazy, penghentian polling dan renderer saat berpindah rute, serta pemulihan offline dan retry. Emulasi Chromium tidak menggantikan pengukuran pada perangkat fisik.
