# Kamera, grup, dan pengaturan scanner

Mode **Ikuti pembicara** membingkai meja dan seluruh peserta pada kedua lantai, dengan sasaran 72% dari ruang layar yang bebas dari panel meeting, legenda grup, dan kontrol. Sudut kamera bergeser halus mengikuti posisi pembicara aktual setelah tiba di kursi. Gerakan orbit/pan, tombol zoom, preset, atau reset mengembalikan kendali manual. Aktifkan kembali Ikuti pembicara untuk melanjutkan. Pilihan mengikuti disimpan di browser; reduced motion menghindari transisi kamera.

Empat grup memakai warna dan nama konsisten: SMC/ICT emas, Indikator biru, Volume hijau, Derivatives ungu. Identitas berasal dari pemetaan grup backend. Strip meja, tanda grup, aksen kursi, badge karakter, legenda, dan balon memakai identitas tersebut. BUY/SELL tetap berupa teks dan warna keputusan yang terpisah. Risk dan Head Trader memiliki identitas sendiri.

Balon menyajikan nama, arah, grup, dan satu kalimat ringkas dari output aktual. Ketuk balon untuk membaca output lengkap, sumber scanner/AI, confidence AI bila tersedia, dan reasoning. Ringkasan visual tidak mengubah data analisis.

Animasi berjalan mengikuti jarak tempuh, dengan peralihan pose yang halus dan pendengar menoleh ke pembicara. Pose idle diperbarui lebih jarang. Low/Medium mempertahankan dua lantai, memakai pencahayaan sederhana dan membatasi cadence render. Render tidak dipicu oleh cadence ketika tab tersembunyi. Contact shadow dekoratif dirender sekali; directional shadow tetap mengikuti profil kualitas.

Di **Admin → Trading Config → Scanner, context, dan budget settings**, parameter scanner kini berupa form angka: tiga EMA, periode indikator, ADX minimum, rasio volume, dua ambang RSI momentum, dua ambang RSI reversion, deviasi Bollinger Band, jendela struktur, dan displacement ATR. Penjelasan tiap parameter tersedia di bawah input. Schema konfigurasi backend tetap memvalidasi batas angka dan hubungan EMA/RSI; input kosong atau konfigurasi tidak valid memblokir Save.

Simpan melalui **NEXT CASE** atau **APPLY NOW** yang memiliki konfirmasi penggantian case aktif. Context dan budget tetap memakai editor JSON. Jadwal scanner tetap mengikuti cron lima menit; perubahan tampilan tidak mengubah syarat konsensus, idempotensi, atau guard trading.

Validasi mencakup proyeksi kamera terhadap HUD pada tiga ukuran layar, browser dengan WebGL software, penyimpanan nilai scanner melalui UI ke Worker/D1, dan pemeriksaan repository. Hasil WebGL software bukan ukuran performa GPU ponsel fisik.
