# Pilihan 4 atau 8 AI untuk voting

Buka **Admin → Trading Config → Jumlah AI untuk voting**, pilih mode, lalu **Save new version**. Default tetap **8 AI**. Konfigurasi lama yang belum memiliki `aiVoterCount` dibaca sebagai 8; tidak perlu migration database baru.

| Mode | Analis yang ikut voting | Review setelah voting | Panggilan dasar |
| --- | --- | --- | --- |
| 4 AI | Trend (Indicators), Structure (SMC/ICT), Volume, Derivatives | Risk Manager dan Boss | 6 |
| 8 AI | Trend, Structure, Momentum, Liquidity, Volume, Quant, Derivatives, Positioning | Risk Manager dan Boss | 10 |

Panggilan dasar dihitung ketika setiap peran berhasil dalam satu percobaan. Retry dan fallback dapat menambah jumlah panggilan. Mode 4 memberi satu wakil untuk setiap grup dengan lebih sedikit pendapat; penghematan token/biaya bergantung pada model dan hasil permintaan, bukan hanya jumlah peran.

**NEXT CASE** mempertahankan mode case aktif dan menerapkan pilihan untuk case berikutnya. **APPLY NOW** membatalkan case aktif sebagai `CONFIG_CHANGED` dan membuat pengganti dengan pilihan baru setelah konfirmasi. Config, daftar karakter, provider/model dan prompt disimpan pada snapshot case. Recovery dan retry memakai roster yang sama; analis yang tidak dipilih tidak dipanggil dan tidak masuk denominator confidence.

Scanner tetap memeriksa empat grup setiap cron lima menit. Ambang default minimal dua grup searah serta aturan konflik BUY/SELL tetap berlaku. Meeting scanner tanpa AI tidak berubah. Pilihan ini mengatur jumlah analis saat sebuah case benar-benar masuk pipeline AI; Risk/Boss tetap mereview sesudah voting dan bukan tambahan suara analis.

Voting membutuhkan sedikitnya separuh roster memberikan output sukses: 2 dari 4 atau 4 dari 8. Sedikitnya dua suara directional dibutuhkan untuk menentukan arah AI. `NO_TRADE` adalah abstain, output tidak valid/unavailable tidak ikut voting, tie tetap melalui Boss, dan Boss tidak boleh membalik majority normal. Jalur degraded/fallback, validasi risiko, freshness, quota, dan publikasi sinyal tetap dijalankan.

Simulation `COMPATIBLE` mengikuti konfigurasi yang dipilih. `STRICT` mempertahankan **roster 4/8 dan identitas provider/model** dari case historis, termasuk ketika pilihan current sudah berubah; parameter non-AI tetap mengikuti mode konfigurasi simulation yang dipilih.

API config menerima `aiVoterCount: 4 | 8`. `/office/state` menampilkan `ai_voter_count` untuk case baru dan `active.participants` dari snapshot case aktif. `/office/meeting` menyertakan `participants` yang sama; hanya output peserta ini masuk dialog/failure notice. API tidak mengirim context atau prompt melalui metadata roster. Tampilan Operations, HUD meeting dan routing karakter 3D mengikuti daftar peserta: dalam meeting AI mode 4, empat analis lain tetap memantau di meja.

Pengujian mencakup mode legacy/4/8, quorum/confidence, case live, simulation compatible/strict, deduplikasi request, roster meeting, pergantian NEXT CASE/APPLY NOW dan UI desktop/portrait/landscape. Respons provider memakai fixture sintetis; hasil lokal tidak menyatakan acceptance provider atau deployment produksi.
