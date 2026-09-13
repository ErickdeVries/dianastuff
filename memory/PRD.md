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


## Next Tasks
1. Admin approval dashboard.
2. Store profile editor (logo/banner upload via Object Storage).
3. Product catalog screens.
