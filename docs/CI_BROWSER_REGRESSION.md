# Regresi browser CI — 10 Oktober 2026

[Run 38027946286](https://github.com/harvey-moeid/byga_office/actions/runs/38027946286) pada PR #36 menguji merge commit `bff4412203174df709bc05ce75bfb6376d81f25f`, dengan source branch `c6bb0f218cc67935d546d1394f3e64ecc43814aa`. Hasil suite browser: **86 lulus, 1 gagal**. Chromium CI adalah Chrome Headless Shell 153.0.8010.12; trace capture aktif dan worker diserialkan.

Kegagalan berada pada `3D speech follows the seated character and opens the actual result detail`, viewport desktop. Pemeriksaan bahwa bubble Head Trader terlihat selesai, tetapi `boss.dispatchEvent("click")` berikutnya menunggu bubble yang sudah tidak ada hingga timeout test 120 detik. Bubble sengaja mengikuti pergantian speaker dan tampil selama tujuh detik. Dua command Playwright terpisah tidak mempertahankan keberadaan DOM di antara command; software WebGL dan trace capture dapat memperbesar jedanya.

Perbaikan berada pada harness browser, tanpa perubahan runtime aplikasi. `page.waitForFunction` kini memeriksa label percakapan, visibilitas CSS/opacity dan ukuran bubble, menangkap geometri, lalu mengirim klik dalam satu tugas JavaScript browser. Pola ini dipakai untuk Trend Analyst dan Head Trader. Dialog tetap harus memuat penjelasan fixture karakter yang benar; pemeriksaan posisi, overlap overlay, camera state dan JavaScript error tetap aktif. Timeout dan durasi percakapan tidak dinaikkan, tidak ada retry otomatis tambahan, dan tes tidak di-skip untuk mengatasi kegagalan ini.

Jalankan konfigurasi CI dari root repository:

```bash
CI=true npm run test:browser -- --grep '3D speech follows' --workers=1 --reporter=line,html --trace=retain-on-failure
CI=true npm run test:browser -- --workers=1 --reporter=line,html --trace=retain-on-failure
```

Untuk Chromium sistem, tambahkan `BYGA_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. Server Vite yang memakai port 5173 harus dihentikan sebelum menjalankan mode CI, karena mode ini menyalakan server tes sendiri.

Unduhan versi Chromium CI melalui CDN Playwright dan distribusi resmi Chrome for Testing ditolak jaringan cloud dengan HTTP 403. Validasi lokal memakai Chromium 151.0.7922.173 yang sudah tersedia, dengan mode CI, trace capture dan tiga viewport yang sama. Hasil lokal tidak membuktikan hasil Chromium 153 di GitHub; run CI setelah push menjadi verifikasi versi tersebut. GitHub API untuk membaca ulang run juga ditolak 403 dalam lingkungan cloud ini; diagnosis remote bersumber dari log yang diberikan pengguna.

Perubahan ini hanya mencakup tes dan dokumentasi; tidak memerlukan migration tambahan. Hasil validasi awal pada [laporan UI–API](API_UI_CONTRACT.md) tetap merupakan bukti lokal dari revision sebelumnya. Suite browser–Worker–D1 pada run CI yang gagal tidak berjalan karena step browser pertama gagal.

Validasi follow-up: typecheck dan ESLint lulus. Regresi 3D speech lulus **3/3** pada desktop, mobile portrait dan landscape dalam mode CI dengan trace aktif (3,6 menit), tanpa gagal atau skip. Suite browser penuh kemudian lulus **87/87** dengan konfigurasi yang sama (6,5 menit), tanpa gagal atau skip; `.last-run.json` mencatat `passed` dan tidak ada failed tests. Hasil GitHub Chromium 153 setelah push belum terverifikasi.

Pemeriksaan runtime cloud menemukan snapshot policy `restricted` dengan preset `package_managers`; domain CDN Playwright, Chrome for Testing storage dan GitHub API tidak tercantum. `environment_status` memiliki observasi terkini tetapi state policy `unknown`, sehingga metadata itu bukan bukti enforcement. HTTP 403 pada operasi sebenarnya menjadi bukti bahwa unduhan dan pembacaan API tersebut masih ditolak. Git fetch/push melalui autentikasi repository yang tersedia tetap dapat digunakan.
