# PRD — Diana Stuff

## Original Problem Statement
Single-tenant e-commerce mobile app "Diana Stuff" (React Native Expo + FastAPI + MongoDB).
MVP scope: a Login screen with two tabs — "Login Gmail" (Emergent Google one-tap) and
"Login Whitelist" (username + password, self-register with admin approval), plus a
Material 3 WhatsApp button to request a shopping account (hidden with a fallback text if
the store WhatsApp number is empty). Theme Soft Purple #A855F7 on #FAF5FF, Poppins headings,
Inter body. Language: Indonesian.

## Architecture
- **Frontend**: Expo Router (stack), React Query, react-native-keyboard-controller, expo-image,
  expo-linear-gradient, @react-native-vector-icons/material-design-icons. Theme tokens in
  `src/theme.ts`. Auth state in `src/context/auth.tsx`, API client in `src/api/client.ts`.
- **Backend**: FastAPI (`/api` prefix), Motor/MongoDB. Session tokens stored in `user_sessions`
  (7-day TTL index). bcrypt password hashing. Emergent Google OAuth exchange via `/api/auth/session`.
- **Auth token** stored in secure store (Keychain / localStorage on web) via `@/src/utils/storage`.

## User Personas
- **Buyer**: shops on the app. Signs in with Google, or registers a whitelist account and waits
  for admin approval.
- **Admin**: manages the store. Seeded whitelist account (username `admin`).

## Core Requirements (static)
- Two-tab login (Google + Whitelist).
- Whitelist self-registration → pending → admin approval before login.
- WhatsApp "request account" CTA driven by `profil_admin.whatsapp`.
- Role-aware sessions (admin | buyer).

## Data Model
- `users`: user_id, email, username, password_hash, role, nama, wa, alamat, kota, kode_pos,
  status (pending|approved), auth_provider (google|whitelist), picture, created_at, deleted_at
- `profil_admin`: nama_toko, logo_url, banner_url, rekening_bank[], whatsapp (required)
- `user_sessions`: session_token, user_id, created_at, expires_at (TTL)
- `products`, `orders`, `chats`: reserved (empty for now)

## Implemented (2026-09-13)
- Backend: GET /api/profil_admin; POST /api/auth/session + /api/auth/login-email (Google);
  POST /api/auth/register-whitelist; POST /api/auth/login-whitelist; GET /api/auth/me;
  POST /api/auth/logout. Startup seeds profil_admin (WA 6285312812452) + admin/admin123 + buyer/buyer123.
- Backend admin: products CRUD (GET public + search, POST/PUT/DELETE admin, soft delete);
  customers CRUD (/api/admin/customers, buyers only); PUT /api/profil_admin (WA required);
  GET /api/admin/stats; POST /api/upload + GET /api/files/{path} via Emergent Object Storage.
- Frontend: Login (2 tabs + WhatsApp CTA), Register, Home (admin sees "Buka Dashboard Admin").
- Frontend admin dashboard (/dashboard, admin-only, drawer sidebar): overview stats + quick
  actions; Produk (list/search/add/edit/delete, up to 5 photo uploads); Pelanggan (CRUD +
  approve/pending toggle); Pengaturan Toko (nama_toko, logo, banner, rekening_bank[], WA with
  red "Nomor WA wajib diisi" validation); Pesanan & Chat placeholders.
- Buyer shopping (2026-09-13): Etalase /toko (2-col grid, search, category chips, PO badge);
  Product detail /produk/[id] (photo slider, qty stepper, add to cart); Keranjang /keranjang
  (qty +/- , remove, subtotal); Checkout 3 langkah /checkout (alamat via PUT /api/me, kurir dari
  profil_admin.kurir_list + Cek Ongkir dari collection ongkir_manual, pembayaran transfer manual
  dengan rekening_bank, Total = Subtotal + Ongkir); POST /api/orders membuat orders collection
  (no_order DS-YYMMDD-XXXX, status menunggu_pembayaran, stok berkurang — bisa_po boleh minus);
  /pesanan-saya + /order/[id] (upload bukti bayar, konfirmasi via WhatsApp).
- Verified by testing agent three times: auth (12/12), admin dashboard (26/26), buyer shopping
  (20/20) — no bugs.
- Finalization (2026-09-13): Order lifecycle + Shopee-style status stepper on /order/[id]
  (Menunggu Pembayaran > Sedang Dikemas > Dikirim > Selesai > Beri Ulasan); Konfirmasi
  Pembayaran via WhatsApp (POST konfirmasi-bayar -> menunggu_konfirmasi); admin manajemen
  pesanan /dashboard/pesanan (PUT status: proses, input resi -> dikirim, selesai; lihat bukti);
  Toast global untuk perubahan status; review order (rating 1-5). Chat realtime Socket.IO
  (/api/socket.io) di /chat (buyer) + /dashboard/chat (admin rooms), teks + gambar. WebView
  /webview (iframe di web, react-native-webview di native). Guest boleh lihat /toko + /produk.
  Seed: profil WA 628123456789, rekening BCA/123/Diana, 3 produk baju, admin + buyer. README.md.
- Verified by testing agent (finalization): backend 25/25 + frontend flows — no bugs.

## Backlog (prioritized)
- **P2**: Kurir otomatis (RajaOngkir/dsb) — DIBATALKAN oleh user, diganti form ongkir manual.
- **P3**: Refactor server.py jadi modul + Pydantic models untuk body dict.

## Implemented (2026-06 fork)
- Format tanggal diseragamkan jadi dd/mm/yyyy (util `formatDate`/`formatDateTime` di
  `src/utils/format.ts`); dipakai di riwayat status order, list Pesanan Saya, dan list pesanan admin.
- Ongkir manual: admin CRUD via `/dashboard/ongkir` (list + FAB tambah + modal add/edit +
  hapus). Backend: GET/POST/PUT/DELETE `/api/admin/ongkir` (validasi duplikat kota+kurir,
  harga >=0). Seed 4 tarif contoh saat kosong. Checkout pembeli tetap pakai `GET /api/ongkir`.
- Google login (Emergent OAuth) diverifikasi berjalan di web preview (redirect ke Google benar).
- FIX (2026-09-13): Google login stuck di spinner — gate `_layout.tsx` kini redirect user yang
  kembali ke "/" (setelah OAuth redirect) ke /home (`user && (inAuthGroup || !root)`).
- Dashboard admin: kartu "Penjualan Hari Ini" & "Penjualan Bulan Ini" (sum total order berstatus
  menunggu_konfirmasi/sedang_dikemas/dikirim/selesai, batas hari/bulan dalam WIB) di
  GET /api/admin/stats + /dashboard/index.tsx.
- FIX chat realtime: admin tidak terima pesan — socket connect kini memasukkan admin ke room
  broadcast "admins"; emit message ke [room, "admins"]; dashboard/chat.tsx listen "message" dan
  invalidate rooms+unread; chat.tsx cleanup hanya melepas listener miliknya sendiri.
- FIX sesi: /api/auth/me gagal karena jaringan TIDAK lagi menghapus token (hanya 401 yang
  clearToken) — user tidak perlu login ulang setelah tutup app karena koneksi jelek.
- Admin pesanan: tab filter (Semua/Perlu Konfirmasi/Dikemas/Dikirim/Selesai), tombol eksplisit
  "Konfirmasi Pembayaran Diterima" untuk status menunggu_konfirmasi, "Update Resi / Tracking"
  untuk pesanan dikirim (resi bisa diedit). Backend tidak lagi duplikat status_history saat
  hanya resi yang berubah.
- Notifikasi realtime in-app: socket connect auto-join room user sendiri (+ "admins" untuk admin);
  backend emit "new_order" (POST /orders -> admins) dan "order_status" (PUT status -> room buyer);
  `src/components/notification-listener.tsx` global menampilkan toast + invalidate query
  (chat unread/rooms, orders, admin stats); drawer admin punya badge merah di Chat (unread) &
  Pesanan (perlu_konfirmasi); dashboard depan punya kartu "Notifikasi" (Chat Baru + Pesanan
  Perlu Konfirmasi, tap untuk navigasi). GET /api/admin/stats kini mengembalikan perlu_konfirmasi.
- UX ala Shopee: setelah login, buyer LANGSUNG ke /toko (tanpa layar pilihan); admin tetap ke
  /home. Header /toko: ikon chat (badge unread), keranjang (badge), akun (->/home); tombol back
  hanya muncul jika ada riwayat navigasi. Bottom bar /produk/[id]: ikon chat -> /chat, ikon
  keranjang (tambah ke keranjang + toast), tombol besar "Beli Sekarang <harga*qty>" -> add +
  /checkout. Stepper jumlah pindah ke area info produk.
- Ubah kata sandi sendiri: POST /api/auth/change-password (verifikasi sandi lama, min 6, beda
  dari lama, rotasi semua sesi -> token baru). Layar /dashboard/sandi (drawer "Kata Sandi").
- Branding: tulisan "Diana Stuff" (login + drawer) warna soft purple (brandPrimary #A855F7),
  font Poppins-SemiBold (tegas).
- Penyempurnaan flow pesanan + label kirim:
  - Kartu pesanan admin kini menampilkan daftar nama produk + alamat lengkap penerima
    (nama, wa, alamat, kota, kode pos) — sebelumnya hanya nama & kota.
  - Cetak/preview label alamat: tombol "Cetak / Preview Label Alamat" (status sedang_dikemas
    & dikirim) via expo-print (`src/utils/shipping-label.ts`, buildLabelHtml + printShippingLabel);
    buka print dialog native (iOS/Android) atau browser (web). Berisi toko, no order, penerima,
    alamat, kurir, resi, isi paket.
  - Konfirmasi terima paket oleh pembeli: POST /api/orders/{id}/terima (owner, hanya saat status
    'dikirim' -> 'selesai'); tombol "Pesanan Sudah Diterima" di /order/[id] saat status dikirim.
    Backend emit socket "order_received" ke room "admins" -> NotificationListener admin munculkan
    toast "Paket <no> sudah diterima <nama>" + refresh list. Admin tetap punya "Tandai Selesai"
    sebagai fallback.
- Auto-Selesai: order status 'dikirim' otomatis jadi 'selesai' setelah AUTO_COMPLETE_DAYS (=3) hari
  jika pembeli tak konfirmasi. `dikirim_at` diset saat status->dikirim; sweep `auto_complete_orders()`
  dipanggil lazy di GET /orders & GET /orders/{id} (fallback ke status_history utk order lama),
  emit "order_status" ke pembeli.
- App name (app.json expo.name) = "dianastuff".
- Upload foto Android diperkuat: derive name/ext & mime dari uri (fileName/mimeType sering null di
  Android), Blob hanya untuk web, tidak set Content-Type manual (src/api/uploads.ts).
- Hapus banner/logo tanpa mengganti: chip trash (banner) + tombol "Hapus Logo" (logo) dengan
  ConfirmDialog; onDeleteImage PUT /api/profil_admin dengan url null. Tombol upload logo dibuat
  eksplisit ("+ Tambah Logo"/"Ubah Logo") agar jelas di Android.
- FIX upload mati total di APK Android: pasang dependency eksplisit `expo-image-loader` (modul
  native wajib expo-image-picker yang tidak ter-bundle di release build — jalan di Expo Go, mati
  di APK). uploads.ts: skip permission request di Android (system photo picker tak butuh izin),
  picker dibungkus try/catch agar error muncul (tidak silent). Tombol simpan profil dikunci saat
  upload berjalan. HARUS diverifikasi user lewat build APK baru (tak bisa dites headless).
- Foto rapi: kompres+resize (max 1280px, quality 0.7) via expo-image-manipulator di uploadAsset.
- Share produk via WA/Share sheet: tombol share di header /produk/[id] -> Share.share (fallback
  wa.me) berisi nama+harga+link `${BASE}/produk/{id}`.
- Foto produk bisa diklik -> full-screen ImageViewer (src/components/image-viewer.tsx) pinch-zoom
  + pan + double-tap (gesture-handler + reanimated).
- Beri Ulasan lebih mudah: review kini bisa lampirkan foto (foto_url) selain bintang+komentar
  (POST /orders/{id}/review + product_reviews mengembalikan foto_url). Pengingat: kartu
  "Pesananmu sudah selesai 🎉" di /order/[id] saat status selesai & belum ulasan, toast otomatis
  saat status jadi selesai, dan badge "Beri ulasan ⭐" di list Pesanan Saya.
- LIVE SHOPPING (Agora): backend /api/live/{current,start,stop,token} (token via
  agora_token_builder; AGORA_APP_ID/AGORA_APP_CERTIFICATE di backend/.env; channel
  dianastuff_live; audience token publik, host token admin). Admin /dashboard/live: start/stop +
  pilih produk + broadcaster (native) + share WA. Publik /app/live.tsx: guest boleh nonton, wajib
  login saat checkout; video + produk + keranjang ungu + share. Banner "Sedang LIVE" di /toko.
  Video platform-split: live-video.web.tsx (agora-rtc-sdk-ng), live-video.native.tsx
  (react-native-agora via runtime require -> aman di Expo Go, fallback pesan). Kamera host HANYA
  jalan di build HP asli. react-native-agora TIDAK didaftarkan sbg config plugin (autolinking);
  permissions kamera/mic sudah di app.json.


## Next Tasks
1. Admin approval dashboard.
2. Store profile editor (logo/banner upload via Object Storage).
3. Product catalog screens.

## Implemented (2026-06 fork — Live Shopping interaktif)
- Admin (`/dashboard/live`): tambah field **Caption/Deskripsi**, toggle **Tampilkan Keranjang
  Produk** (show_cart) & toggle **Wajib Login untuk Menonton** (require_login). Tampilan saat live
  menampilkan judul, caption, dan meta (keranjang tampil / tanpa keranjang, wajib login / tamu boleh).
- Backend `POST /api/live/start` menerima `caption`, `show_cart`, `require_login`; `live_public`
  (dipakai `/live/current` & start) kini mengembalikan `caption`, `show_cart`, `require_login`,
  dan `whatsapp` (dari `profil_admin`).
- Viewer (`/app/live.tsx`) dirombak jadi layar live penuh:
  - Judul + caption overlay, badge LIVE, tombol WhatsApp (buka wa.me nomor toko, normalisasi 62),
    Share, Close.
  - **Live chat realtime untuk semua penonton (termasuk tamu tanpa login)** + input komentar.
  - **Reaction rail**: 6 emoji (❤️🔥😍👍👏😮) + tombol Like ungu → hati/emoji beterbangan
    (`src/components/floating-emoji.tsx`, reanimated).
  - Produk (hanya jika `show_cart`): strip horizontal, tap → `/produk/[id]`; FAB ungu → `/toko`.
  - Gate `require_login`: jika wajib login & belum login → layar "Login untuk menonton".
- Socket.IO backend: `connect` kini mengizinkan **guest** (role "guest", tanpa join room user);
  event baru `join_live`/`leave_live` (room "live", kirim histori 50 pesan terakhir ke sid),
  `live_chat` (broadcast + buffer in-memory 100, direset saat start/stop), `live_react` (broadcast
  emoji tervalidasi). `join`/`message` diberi guard tolak guest. Frontend `src/lib/socket.ts` tetap
  connect tanpa token untuk tamu.
- Diverifikasi: backend curl (start/current/stop dengan field baru OK), viewer web preview (guest
  chat muncul, like beterbangan, produk strip + FAB, WA/share/close, reaction rail).
- Jumlah penonton realtime: backend track presence (`LIVE_VIEWERS` sid->{name,role,user_id});
  `join_live`/`leave_live`/`disconnect` update & emit `live_viewers` {count, viewers[]} ke room
  ["live","admins"] (dedup user login by user_id, tamu -> "Tamu"). Reset saat live stop.
  Admin `/dashboard/live`: ikon mata + angka di pojok kanan atas video, tap -> modal
  "Penonton (n)" berisi daftar nama (👑 admin / Tamu). Viewer `/live`: pill mata + angka di
  samping badge LIVE. Diverifikasi via socket.io client probe (guest join -> admin count=1 +
  nama; disconnect -> count=0) & screenshot admin modal.

## Implemented (2026-06 fork — Live: sorot produk, pin, moderasi, rekap)
- **Sorot Produk (featured)**: `live_shows.featured_product_id`. `LiveStart` + `POST /api/live/feature`
  (admin) untuk ganti saat live -> emit `live_feature`. `live_public` kirim `featured` (produk penuh).
  Admin: chip pemilih sorot saat live (+ bintang di picker saat setup). Viewer: bar "⭐ DISOROT"
  dengan tombol **Beli Sekarang** -> tamu diarahkan `/login`, user login -> detail produk `/produk/[id]`.
- **Pin Komentar**: socket `pin_comment`/`unpin_comment` (admin only) -> emit `live_pinned`
  {pinned} ke ["live","admins"]; dikirim ke sid baru saat join. Banner pinned di viewer (atas chat)
  & admin (tombol unpin). `LIVE_PINNED` in-memory.
- **Blokir Penonton (bisukan + keluarkan)**: socket `mod_mute` {uid,mute} & `mod_kick` {uid}
  (admin only). `LIVE_MUTED`/`LIVE_KICKED` set (by user_id; tamu uid=`guest_{sid}`). Muted ->
  `live_chat` ditolak + emit `live_muted` (viewer input jadi "Anda dibisukan admin"). Kick -> keluar
  room + `live_kicked` (viewer layar "Anda dikeluarkan") + tolak rejoin. Aksi di modal Penonton
  (mic/kick) & tiap komentar di panel admin.
- **Panel Komentar Admin**: admin terima `live_chat` lewat room "admins" (tanpa join_live -> tak
  terhitung penonton); msg bawa `uid` utk moderasi; admin bisa balas komentar.
- **Rekap Live**: `LIVE_STATS` {peak_viewers,total_likes} in-memory. Saat `live/stop` hitung pesanan
  (count+total) rentang started..ended, simpan `recap` di doc. `GET /api/admin/live-history`
  (admin). Layar `/dashboard/live-rekap` (drawer "Rekap Live").
- Nonton tanpa install: link `${BASE}/live` jalan di browser HP untuk tamu (Expo web).
- Diverifikasi: socket probe (featured start/change, guest chat->admin, pin, mute+block chat,
  kick+remove viewer, recap) + screenshot viewer (bar sorot) & admin (chips sorot, panel komentar, rekap).

## Implemented (2026-06 fork — Studio Live full-screen host + kamera)
- Layar host live dipindah ke full-screen `/app/live-host.tsx` (route top-level, tanpa drawer/header)
  meniru layout penonton: video absolute fill, overlay transparan (LIVE+eye, chat, pinned).
  Sebelumnya host tampil setengah layar + kotak hitam di dalam drawer.
- `dashboard/live.tsx`: form setup (belum live) -> saat "Mulai Siaran Live" sukses push ke
  `/live-host`. Saat sudah live tampil kartu ringkas + tombol "Buka Studio Live" / Rekap / Akhiri.
- Kontrol host di studio: ganti kamera depan/belakang (`switchCamera`) TANPA akhiri live;
  selector filter kamera (Normal/Halus/Cerah/Vivid/Jernih/Low Light) via `applyFilter`; share;
  tombol power (akhiri, pakai ConfirmDialog); eye count -> modal penonton (bisukan/keluarkan);
  komentar live transparan (tap komentar -> action sheet Pin/Bisukan/Keluarkan); input balas;
  hati/emoji beterbangan (live_react kini diemit ke ["live","admins"] agar host lihat).
- `LiveVideo` (native/web/fallback) kini `forwardRef` dgn handle {switchCamera, applyFilter}.
  Native pakai Agora: setBeautyEffectOptions (halus/cerah), setColorEnhanceOptions (vivid),
  setVideoDenoiserOptions (jernih), setLowlightEnhanceOptions (low light), switchCamera().
  SEMUA dibungkus try/catch + enableExtension clear_vision. HANYA jalan di build HP asli
  (bukan Expo Go/web) — WAJIB diverifikasi user via build.
- Diverifikasi layout full-screen via screenshot web (video hitam di web itu wajar krn kamera host
  hanya aktif di build). Backend live_react fanout ke admins sudah diuji.

## Implemented (2026-06 fork — Studio Live: notch fix, kualitas video, beauty slider)
- Kontrol atas studio diturunkan ke insets.top + 16 agar tombol ganti kamera tidak tertutup
  notch/dynamic island HP.
- Kualitas video: chip HD / Normal / Hemat Data -> LiveVideo.setQuality (Agora
  setVideoEncoderConfiguration: HD 1280x720@24, Normal 640x480@15, Hemat 480x360@15 bitrate 400).
- Beauty slider (@react-native-community/slider) muncul saat filter Halus/Cerah -> atur
  smoothness/lightening via applyFilter(id, level 0..1) real-time.
- Hanya aktif di build HP asli (Agora); di web/Expo Go video hitam (wajar).
- FIX margin bawah live: kolom chat & input bar pakai Math.max(insets.bottom,12)+12 (host &
  penonton) + chat overlay host diangkat dgn safe-area agar tidak tertimpa tombol navigasi HP.
