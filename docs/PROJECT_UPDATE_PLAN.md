# BYGA Office — Project Update Plan

> Status: Active roadmap  
> Repository: `harvey-moeid/byga_office`  
> Primary objective: menaikkan kualitas visual 3D dari premium-stylized menuju realistic miniature trading office tanpa mengganggu trading engine, AI orchestration, cron, atau integrasi production.

## 1. Prinsip utama

Semua update visual harus mengikuti aturan berikut:

- `chart_db` tetap **read-only**.
- Jangan mengubah kontrak `CharacterId`, role AI, provider mapping, routing, meeting state, consensus, risk flow, Discord flow, atau backend API tanpa kebutuhan terpisah.
- Perubahan 3D harus bersifat presentation-layer.
- Mobile harus tetap menjadi target utama performa.
- Setiap fitur visual baru wajib memiliki fallback yang aman.
- Tidak boleh menambah asset dengan lisensi yang tidak jelas.
- Asset eksternal yang dipakai harus bisa disimpan lokal, memiliki lisensi yang kompatibel untuk penggunaan production/commercial, dan tidak bergantung CDN runtime.
- Kualitas visual tidak boleh dicapai dengan mengorbankan stabilitas meeting, speech bubble, navigation, fullscreen, atau acceptance test.

---

# Phase 1 — Rigged Character Overhaul

## Goal

Mengganti karakter procedural sebagai renderer utama pada Medium/High/Ultra dengan humanoid rigged yang memiliki skeleton, animation mixer, dan state transition yang nyata.

Target hasil:

- karakter terasa hidup;
- gerakan tidak lagi dominan berbasis sinusoidal procedural animation;
- transition antar aktivitas terlihat halus;
- setiap karakter tetap mempertahankan identitas, outfit, role, AI, dan lokasi yang sudah ada.

## Scope

### 1.1 Humanoid rig foundation

- Tambahkan humanoid rig GLTF lokal.
- Gunakan skeleton yang konsisten untuk semua karakter.
- Pertahankan satu reusable base rig agar footprint asset tetap kecil.
- Warna kulit, rambut, pakaian, accent, celana, sepatu, dan atribut role ditentukan saat runtime.
- Pertahankan per-character outfit variation.
- Boss tetap memiliki visual identity yang berbeda.

### 1.2 Animation library

Minimal animation state:

- `idle`
- `walk`
- `sit`
- `type`
- `talk`
- `coffee`
- `stretch`
- `review`

Meeting dan office activity harus memetakan state lama ke animation state baru tanpa mengubah navigation logic.

### 1.3 Animation state machine

Gunakan:

- `AnimationMixer`;
- named `AnimationClip`;
- fade-in / fade-out;
- crossfade antar state;
- no hard pose snapping;
- reduced-motion tetap dihormati.

Transition utama:

```text
idle
  ↕
walk
  ↓
sit
  ↔ type
  ↔ talk
  ↔ review

idle ↔ coffee
idle ↔ stretch
```

### 1.4 Existing logic that must remain unchanged

- meeting participant assignment;
- boss meeting attendance;
- route planning;
- collision/navigation logic;
- destination calculation;
- speech bubble;
- character modal/detail;
- provider assignment;
- consensus logic;
- market data flow;
- Discord notification;
- idle activity scheduling.

### 1.5 LOD / fallback

Recommended policy:

| Quality | Character renderer |
|---|---|
| Low | procedural / lightweight fallback |
| Medium | rigged humanoid |
| High | rigged humanoid |
| Ultra | rigged humanoid + highest material/shadow settings |

If GLTF loading fails, application must degrade gracefully instead of losing the entire office scene.

## Acceptance criteria

Phase 1 dianggap selesai jika:

- semua karakter tetap bisa menuju desk/meeting/activity destination;
- tidak ada teleport akibat perubahan renderer;
- boss ikut meeting;
- sitting alignment tidak membuat karakter menghadap arah salah;
- walk → sit → talk/type transition halus;
- tidak ada duplicated skeleton/mixer leak;
- tidak ada material disposal bug antar karakter;
- Low quality masih usable di HP lemah;
- Medium quality menjadi baseline HP utama;
- speech bubble tetap mengikuti karakter;
- fullscreen tetap berfungsi;
- WebGL context recovery/fallback tetap berfungsi;
- existing browser acceptance tests tetap hijau;
- ditambahkan test untuk rigged renderer dan animation state mapping.

## Expected impact

Visual realism:
- sebelum Phase 1: sekitar 60–65/100;
- setelah Phase 1 target: sekitar 72–78/100.

---

# Phase 2 — Environment Fidelity

## Goal

Menghilangkan kesan primitive/boxy pada elemen yang paling terlihat kamera.

## Priority order

1. analyst chair;
2. meeting chair;
3. meeting table;
4. analyst desk;
5. boss desk;
6. sofa;
7. reception furniture;
8. storage/server furniture.

## 2.1 Hero furniture GLB

Ganti asset primitive utama dengan modeled GLB yang memiliki:

- bevel;
- thickness;
- realistic legs/frame;
- seams/upholstery;
- caster/wheel;
- armrest;
- proper proportions.

## 2.2 Architectural bevel pass

Tambahkan rounded/beveled edge untuk:

- desk;
- cabinet;
- counter;
- partition frame;
- wall trims;
- meeting table;
- server rack;
- display plinth.

## 2.3 PBR material system

Gunakan material dengan kombinasi sesuai kebutuhan:

- baseColor;
- normal;
- roughness;
- ambient occlusion;
- optional height/bump.

Material utama:

- walnut;
- oak;
- painted wall/plaster;
- leather;
- fabric;
- carpet;
- brushed metal;
- dark metal;
- glass.

Texture budget:

- Low: 256–512 px;
- Medium: 512–1024 px;
- High: 1K;
- Ultra: maksimal 2K untuk hero asset.

## Acceptance criteria

- tidak ada hero furniture yang terlihat seperti cube-scaled placeholder;
- bevel terlihat saat terkena key light;
- material memiliki roughness variation;
- PBR tidak membuat asset tampak terlalu glossy;
- texture memory aman di mobile;
- scene tetap readable pada Low/Medium.

## Expected impact

Visual realism target setelah Phase 2:

**80–86/100**

---

# Phase 3 — Rendering & Cinematic Lighting

## Goal

Memberikan depth, grounding, dan lighting hierarchy tanpa membuat scene berat atau berlebihan.

## 3.1 Ambient grounding

Prioritas:

- baked AO jika memungkinkan;
- atau GTAO/SSAO yang cukup ringan;
- ContactShadows tetap dipakai secara selektif.

Fokus area:

- kaki furniture;
- desk-floor contact;
- meeting room;
- sofa;
- cabinet;
- wall corner;
- under-desk area.

## 3.2 Lighting refinement

Pisahkan:

- warm practical lighting;
- primary key;
- cooler fill;
- subtle edge/rim;
- environment reflection.

Target:

- wajah karakter tetap terbaca;
- boss room terasa lebih premium;
- meeting room memiliki visual focus;
- monitor tidak overexposed;
- dark area tidak crush.

## 3.3 Reflection & environment

- gunakan HDR/environment lighting lokal atau baked equivalent;
- jangan bergantung pada remote CDN;
- reflection resolution mengikuti quality profile.

## 3.4 Post-processing

Hanya gunakan bila memberi dampak nyata:

- subtle bloom;
- restrained vignette;
- tone/exposure balancing;
- optional depth-of-field khusus cinematic camera.

Hindari:

- bloom berat;
- excessive chromatic aberration;
- cinematic effect yang mengurangi readability UI.

## Acceptance criteria

- scene tetap tajam;
- UI/speech bubble tetap readable;
- lighting tidak flicker;
- tidak ada shadow acne mencolok;
- exposure konsisten antar camera preset;
- mobile Medium tetap stabil.

## Expected impact

Visual realism target setelah Phase 3:

**88–92/100**

---

# Phase 4 — Performance, Mobile UX & Final Polish

## Goal

Menjaga realism tinggi dengan performa production yang stabil.

## 4.1 Quality profiles

Recommended:

### Low

- procedural/very-low character LOD;
- minimum shadows;
- reduced reflection;
- no AO/post-processing mahal;
- core art direction tetap dipertahankan.

### Medium

Target utama HP.

- rigged character;
- medium texture;
- reasonable shadows;
- essential reflections;
- lightweight AO jika budget memungkinkan.

### High

- higher texture resolution;
- higher shadow quality;
- stronger environment quality;
- AO;
- premium asset LOD.

### Ultra

Desktop/high-end device.

- highest character/furniture LOD;
- high-resolution shadows;
- richer reflections;
- cinematic post-processing.

## 4.2 Adaptive quality

Perbaiki auto quality supaya:

- dapat downgrade saat FPS rendah;
- dapat recover/upgrade secara bertahap;
- memiliki hysteresis agar tidak naik-turun terus;
- tidak mengganti pilihan manual user.

## 4.3 Mobile UI cleanup

Perbaiki:

- camera preset buttons menjadi compact selector/dropdown di layar kecil;
- fullscreen button tidak overlap home menu;
- touch targets minimal nyaman;
- modal tidak overflow;
- HUD tidak menutup speech bubble;
- safe-area notch/navigation bar.

## 4.4 Detail pass

Tambahkan hanya setelah performance stabil:

- keyboard detail;
- mouse;
- cables;
- coffee cups;
- desk lamp;
- documents;
- books;
- acoustic panel;
- server LEDs;
- wall art;
- office clock;
- subtle plant variation;
- workstation personal props.

## Final acceptance criteria

- mobile portrait 360px tidak overflow;
- fullscreen bekerja di supported browser;
- camera controls tidak overlap;
- meeting bubble tidak tertutup UI;
- scene tidak kehilangan state saat quality berubah;
- stable render setelah prolonged session;
- no obvious GPU resource leak;
- no console error;
- CI hijau;
- production smoke test hijau.

## Final target

| Area | Target |
|---|---:|
| Character quality | 90+ |
| Human animation | 90+ |
| Furniture/detail | 90+ |
| Materials | 90+ |
| Lighting | 90+ |
| Camera/navigation | 92+ |
| Meeting presentation | 92+ |
| Mobile UX | 90+ |
| Performance engineering | 90+ |
| Production readiness | 95+ |
| Overall visual realism | 90–93 |
| Overall 3D web experience | 92–95 |

---

# Implementation order

```text
Phase 1
  Rigged humanoid
  → animation clips
  → crossfade state machine
  → meeting/desk/activity validation
  → mobile LOD
  → tests

Phase 2
  Hero furniture
  → bevel
  → PBR textures
  → material optimization

Phase 3
  AO/GI
  → lighting
  → environment reflections
  → restrained post-processing

Phase 4
  LOD
  → adaptive quality
  → mobile controls
  → final decorative polish
  → production QA
```

---

# Non-goals for this roadmap

Roadmap visual ini **tidak** mencakup perubahan pada:

- scanner logic;
- consensus semantics;
- AI prompt architecture;
- provider selection;
- risk algorithm;
- cron schedule;
- market data ingestion;
- `chart_db` schema;
- Discord business logic.

Jika area tersebut perlu diubah, kerjakan dalam task/branch terpisah agar risiko regression tetap rendah.

---

# Definition of Done

Update visual dianggap production-ready hanya jika seluruh kondisi berikut terpenuhi:

1. code/type checks lulus;
2. browser tests lulus;
3. production acceptance lulus;
4. mobile layout tidak overflow;
5. meeting dan idle activities tetap berfungsi;
6. character state tidak desync dengan backend;
7. tidak ada resource leak besar;
8. Low/Medium/High/Ultra memiliki perilaku yang jelas;
9. fallback tersedia;
10. perubahan didokumentasikan di README/changelog bila sudah merge.

---

## Current execution status

- [x] Roadmap visual ditetapkan.
- [x] Phase 1 branch dibuat.
- [x] Rigged character renderer foundation dibuat.
- [x] Runtime animation clip system mulai diintegrasikan.
- [ ] Final rig asset dimasukkan ke repository.
- [ ] Animation mapping diverifikasi untuk seluruh activity.
- [ ] Rigged character tests ditambahkan.
- [ ] Browser acceptance dijalankan.
- [ ] Mobile acceptance dijalankan.
- [ ] Phase 1 merge ke `main`.

