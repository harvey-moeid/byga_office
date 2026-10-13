# Audit frontend & 3D — 12 Oktober 2026

Review dilakukan pada checkout lokal, dengan API fixture dan Chromium. Fokus: pengalaman mobile, kontrol kamera, keterbacaan, aksesibilitas, dan tampilan premium.

## Temuan dan perbaikan

| Temuan | Perbaikan |
| --- | --- |
| Pada portrait 393 px, preset kamera hanya mendapat lebar sekitar 153 px. | Dock dua baris pada viewport ≤1100 px. Preset mendapat satu baris penuh, dengan scroll horizontal dan otomatis terlihat ketika mendapat fokus keyboard. |
| Pemilih kualitas bertumpuk dengan kontrol kamera pada landscape 915 × 412. | Pemilih kualitas menjadi bagian dock yang sama. Semua tindakan utama punya tinggi minimum 44 px. |
| Gaya form global mengubah label kualitas menjadi kolom, meskipun kontrol semula dirancang horizontal. | Arah flex label dinyatakan secara eksplisit. Label visual disederhanakan pada layar kecil; nama aksesibel tetap tersedia. |
| Kegagalan renderer yang ditangkap error boundary meninggalkan pesan tanpa tampilan tim. | Error boundary memakai jalur fallback yang sama dengan kehilangan konteks WebGL: renderer dilepas, Operations dipilih, dan kartu tim tetap bisa membuka detail. |
| Browser yang menolak localStorage bisa menggagalkan inisialisasi/persistensi scene. | Pembacaan dan penulisan preferensi memakai akses aman; pilihan tetap berlaku dalam state selama kunjungan. |
| Menu Home tidak mengelola fokus keyboard. | Fokus masuk ke tautan navigasi yang terlihat, Tab tetap dalam menu/tombol penutup, Escape menutup menu, fokus kembali ke pembuka, dan konten utama memakai `inert` saat menu terbuka. |
| Teks metrik mobile berukuran 8 px dan teks scanner 8–9 px. | Teks pendukung menjadi 11 px, form mobile memakai 16 px, fokus textarea terlihat, dan navigasi mobile mempertimbangkan safe area. |
| Filter Signals meluber pada lebar 320 px karena lebar minimum intrinsik select dan tanggal. | Kolom grid menggunakan `minmax(0, 1fr)` dan input/select boleh menyusut ke lebar kolom. Regresi memeriksa pemilihan scanner pada layar 320 px. |
| Sepuluh kartu tim membuat scanner di Operations mobile terlalu jauh di bawah. | Kartu tim menjadi baris horizontal yang bisa digeser pada mobile; semua anggota tetap bisa diakses melalui keyboard dan membuka detail. |
| Mode ringan belum mendapat fondasi diorama seperti mode dekoratif. | Fondasi bersama dengan tepian champagne menggunakan tiga mesh sederhana dan satu nameplate lokal, tanpa lampu atau unduhan tambahan. |

## Arah visual

Charcoal dan emerald tetap menjadi warna utama, dengan champagne untuk detail metal, status, dan navigasi. Kartu memakai radius dan lapisan permukaan yang lebih konsisten. Dock kamera memiliki latar transparan berblur, sementara status kantor memakai pill yang lebih terbaca.

Pengaturan kualitas tetap Medium untuk pengunjung baru. Low tetap memuat kedua lantai. Furnitur dan refleksi lebih berat tetap mengikuti profil High/Ultra.

## Verifikasi

- Audit screenshot sebelum/sesudah: 320 × 640, 393 × 851, 915 × 412, dan 1440 × 900.
- Home, Operations, Scanners, Signals, AI Team, dan Admin lolos pemeriksaan tanpa overflow horizontal pada 320 dan 393 px.
- Regresi khusus di `browser-tests/premium-mobile.spec.ts`: geometri target sentuh, pemisahan kontrol, akses preset Lantai 2, form 320 px, fokus menu, renderer gagal, dan localStorage ditolak.
- Regresi existing memeriksa pemuatan rig, routing meeting, percakapan, fallback WebGL, dan halaman operasi.

Sebanyak **33 kasus browser unik** berhasil diverifikasi pada desktop, portrait, dan landscape melalui beberapa run: 15 kasus baru untuk dock/storage/fallback/fokus/layout, 15 kasus existing untuk renderer/meeting/navigasi, dan 3 kasus existing untuk filter Signals. Kegagalan awal fokus menu desktop diperbaiki lalu lolos saat diuji ulang. Run terakhir untuk layout 320 px, akses kartu tim, form, dan filter Signals lolos 6/6.

TypeScript, ESLint, dan build produksi lolos. Pada pemeriksaan lengkap, 344/345 tes lolos; satu pengujian streamed request backend mendapat `ECONNRESET` dari transport Miniflare/Undici. Tes tersebut lolos saat diperiksa ulang secara terpisah, kemudian seluruh suite terkait lolos 17/17. Pemeriksaan integrasi memerlukan izin menjalankan port loopback lokal; percobaan awal di sandbox biasa gagal dengan `EPERM`.

Bundle scene tetap lazy-loaded, sekitar 300 KB gzip. Vite masih memberi peringatan bahwa ukuran minified scene melebihi 500 KB; peringatan ini tidak disembunyikan.

Emulasi Chromium tidak menetapkan FPS, konsumsi daya, atau kompatibilitas Safari/iPhone pada perangkat fisik. Review ini tidak menjalankan deployment atau menguji provider AI/Discord produksi.
