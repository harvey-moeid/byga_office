# Meeting dan percakapan AI

Home 3D dan tampilan Operations membaca `/api/v1/office/meeting`. Endpoint ini hanya membaca case LIVE dan output karakter yang sudah tersimpan. Tidak ada panggilan AI tambahan untuk animasi atau dialog.

- Enam analis dan Risk Manager menuju meja meeting. Bos menunggu di ruangannya dan masuk pada tahap akhir.
- Gelembung muncul bergiliran, berisi satu atau dua kalimat dari ringkasan AI. Ketuk untuk membuka ringkasan lengkap, reasoning, evidence, risk flags, dan price levels yang tersedia.
- Giliran berbicara tidak diulang saat polling. Di 3D, waktu membaca dimulai setelah karakter duduk dan gelembung tampil. Membuka detail menjeda pergantian pembicara; dialog bisa ditutup dengan tombol atau Escape.
- Bos menyampaikan hasil akhirnya, lalu meeting ditutup dan seluruh peserta kembali ke meja. Jika output AI gagal/tidak valid, UI menandai hasil tidak tersedia tanpa membuat ucapan pengganti.
- Presentasi mengikuti hasil case yang sebenarnya, namun dapat berlanjut setelah pemrosesan backend selesai. Case yang baru selesai tersedia selama tiga menit agar pipeline yang cepat tidak melewati dialog. Case baru mengganti presentasi case lama. Case FAILED/CONFIG_CHANGED menghentikan dialog dan mengembalikan peserta.
- Mode tanpa WebGL memakai gelembung yang sama di Operations. Reduced motion mempercepat perpindahan; detail tetap dapat dibaca dengan keyboard dan di layar mobile.

Respons publik hanya memuat ID/status case serta output AI yang lolos schema; prompt, konfigurasi karakter, provider, model, credential, dan audit snapshot tidak ikut dikirim. Case SIMULATION tidak muncul dalam percakapan LIVE.

Animasi tidak menunda pipeline AI, mengubah voting, membuat signal tambahan, atau mengirim Discord tambahan.
