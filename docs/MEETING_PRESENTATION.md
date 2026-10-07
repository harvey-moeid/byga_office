# Meeting dan percakapan AI

Home 3D dan tampilan Operations membaca `/api/v1/office/meeting`. Endpoint ini hanya membaca case LIVE dan output karakter yang sudah tersimpan. Tidak ada panggilan AI tambahan untuk animasi atau dialog.

- Delapan analis dan Risk Manager menuju meja meeting. Bos menunggu di ruangannya dan masuk pada tahap akhir.
- Gelembung muncul bergiliran, berisi satu atau dua kalimat dari ringkasan AI, vote, dan confidence. BUY, SELL, dan NO_TRADE memiliki treatment visual berbeda tanpa mengubah hasil analisis. Ketuk untuk membuka ringkasan lengkap, reasoning, evidence, risk flags, dan price levels yang tersedia.
- Giliran berbicara tidak diulang saat polling. Di 3D, waktu membaca dimulai setelah karakter duduk dan gelembung benar-benar berada di layar; memutar kamera menjauh menjeda giliran. Posisi bubble memakai ukuran aktual dan menghindari HUD/status/control yang sedang tampil. Membuka detail juga menjeda pergantian pembicara; dialog bisa ditutup dengan tombol atau Escape.
- Bos menyampaikan hasil akhirnya, lalu meeting ditutup dan seluruh peserta kembali ke meja. Jika output AI gagal/tidak valid, UI menandai hasil tidak tersedia tanpa membuat ucapan pengganti.
- Presentasi mengikuti hasil case yang sebenarnya, namun dapat berlanjut setelah pemrosesan backend selesai. Case yang baru selesai tersedia selama tiga menit agar pipeline yang cepat tidak melewati dialog. Case baru mengganti presentasi case lama. Case FAILED/CONFIG_CHANGED menghentikan dialog dan mengembalikan peserta.
- Mode tanpa WebGL memakai gelembung yang sama di Operations. Status karakter dihitung per karakter (misalnya WALKING TO MEETING, SPEAKING, WAITING FOR OUTPUT, RETURNING, atau aktivitas dekoratif), bukan dari satu flag global. Reduced motion mempercepat perpindahan; detail tetap dapat dibaca dengan keyboard dan di layar mobile.
- Di 3D, setiap karakter dapat diketuk untuk membuka gelembung konteks yang mengikuti posisi kepalanya, termasuk saat duduk, berjalan, kembali ke meja, coffee break, stretching, review market, diskusi, roaming, atau briefing. Copy membedakan perjalanan menuju aktivitas dari aktivitas yang sudah berlangsung berdasarkan motion aktual karakter. Gelembung memakai status live, grup analis, dan output case aktif yang sudah tersimpan bila tersedia; interaksi ini tidak memanggil AI. Hanya satu bubble inspeksi manual aktif pada satu waktu, ketuk bubble untuk membuka detail karakter, klik area kosong untuk menutup, dan bubble speaker meeting tetap mendapat prioritas visual serta dihindari oleh positioning bubble manual.

Respons publik hanya memuat ID/status case serta output AI yang lolos schema; prompt, konfigurasi karakter, provider, model, credential, dan audit snapshot tidak ikut dikirim. Case SIMULATION tidak muncul dalam percakapan LIVE.

Animasi tidak menunda pipeline AI, mengubah voting, membuat signal tambahan, atau mengirim Discord tambahan.
