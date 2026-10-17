# API key melalui Admin

Buka **Admin → Providers → API key provider**. Pilih provider, masukkan key baru, lalu tekan **Simpan API key** atau **Ganti API key**. OpenAI, Gemini, Groq, OpenRouter, Mistral, Hugging Face, Cohere, dan NVIDIA didukung. Cloudflare Workers AI memakai binding `AI`.

Key tersimpan tidak bisa dibaca kembali melalui UI atau API. Form dikosongkan setelah dikirim, ketika berganti provider, dan ketika sesi Admin berakhir. Nilainya tidak disimpan di localStorage/sessionStorage. Menyimpan key tidak menjalankan inference. Untuk provider berbasis API key, **Test connection** memeriksa katalog model dan melaporkan inference `NOT_TESTED`; keberhasilan katalog tidak mereset circuit kegagalan. Provider/model tiap karakter dipilih di **AI Characters**. Mengganti provider mengosongkan model lama pada jalur itu (Workers AI memakai default yang dipatok). Gunakan **Test primary/fallback model** untuk satu inference sintetis terbatas dengan model terpilih; tes ini dapat memakai kuota, tidak membuat sinyal, dan hanya mereset circuit setelah inference lulus dengan versi key yang sama. Lihat [runbook produksi](PRODUCTION_OPERATIONS.md).

Key UI diprioritaskan untuk permintaan AI baru. Permintaan yang sedang berjalan menyelesaikan pekerjaannya dengan snapshot key sebelumnya. Penggantian key menghapus cache model dan mereset circuit provider; respons lama tidak boleh mengisi cache atau membuka circuit key baru. **Hapus key dari UI** membutuhkan konfirmasi dan kembali memakai Worker runtime secret jika tersedia. Jika key tersimpan tidak dapat didekripsi, provider berstatus terkunci dan tidak diam-diam memakai akun runtime lain.

Circuit mengikuti versi key pada proses live maupun simulasi. Kegagalan atau lease probe dari versi lama tidak menghalangi akun yang baru dipilih, termasuk ketika salah satu proses belum memuat ulang statusnya.

## Menyiapkan penyimpanan

Untuk pengembangan lokal:

```sh
npm run db:migrate
npm run credentials:setup
npm run dev:api -- --local
```

Migrasi `0008_provider_credentials.sql` hanya untuk D1 aplikasi `trading_office_db`. Jangan terapkan pada `chart_db`. Script lokal membuat `PROVIDER_KEYS_ENCRYPTION_KEY` sekali dalam `.dev.vars` yang diabaikan Git, tanpa mencetak nilai dan tanpa mengubah secret lain. File diberi izin `0600`; menjalankan ulang script mempertahankan root yang sudah valid.

Untuk staging/production, workflow deployment menerapkan migrasi aplikasi dan menginisialisasi root sebagai Cloudflare Worker Secret jika belum ada. Untuk deployment manual, setelah konfigurasi dan Worker tujuan tersedia:

```sh
node scripts/credentials-key.mjs --config "$BYGA_DEPLOY_CONFIG"
```

Root enkripsi harus berupa 32 byte acak dalam format 64 digit hex. Jangan masukkan root ke frontend, variabel `VITE_*`, Git, atau chat. **Pertahankan root pada deployment berikutnya**; merotasi atau kehilangan root membuat key UI lama tidak bisa didekripsi. Jika itu terjadi, siapkan root yang valid dan masukkan ulang key provider atau hapus override terkunci. Backup D1 membutuhkan root yang sama untuk memulihkan credentials.

Kebutuhan secret GitHub untuk deployment dan probe provider yang ada tetap berlaku. Key UI merupakan override runtime, tidak mengganti kredensial yang dipakai alat CI sebelum Worker diterbitkan.

## Kontrak dan perlindungan

- `GET /api/v1/admin/credentials`: hanya metadata status, sumber (`UI`, `RUNTIME`, `BINDING`, `MISSING`, `LOCKED`), versi, waktu perubahan, dan kesiapan penyimpanan.
- `POST /api/v1/admin/credentials`: `SAVE` membutuhkan provider, key baru, dan `expectedVersion` (`null` untuk key UI pertama). `DELETE` membutuhkan versi aktif dan `confirmed: true`.
- Login Admin, pemeriksaan origin, batas body, rate limit, dan respons tanpa cache mengikuti API Admin yang ada. Konflik versi menghasilkan HTTP 409 dan tidak menimpa perubahan terbaru.
- AES-256-GCM menggunakan IV acak per penulisan dan mengautentikasi provider serta versi. D1 menyimpan ciphertext; root tetap terpisah sebagai Worker Secret. Nilai key tidak disalin ke receipt operasi, konfigurasi karakter, atau respons HTTP. Redaksi provider mencakup key plaintext, bentuk JSON, dan URL encoding sebelum respons AI masuk audit.
- Jika respons simpan hilang, muat status terbaru sebelum memasukkan ulang key. UI tidak menyimpan payload secret untuk retry otomatis. Status tersimpan tidak membuktikan bahwa provider menerima key tersebut.

Tes menggunakan key sintetis, actual workerd/D1, dan browser desktop/portrait/landscape. Tidak ada inference berbayar atau pengiriman Discord saat validasi ini.
