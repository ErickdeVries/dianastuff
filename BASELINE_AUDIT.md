# dianastuff — Baseline Audit & Backup Manifest

Tanggal audit: 2026-10 (fork)
Versi APK terbaru: **1.0.13**
Ukuran server.py: ~3.077 baris, ~86 endpoint (`@api_router`)

## 1. Ringkasan Aplikasi
- Nama: **dianastuff** — e-commerce single-tenant (siap jadi multi-tenant, semua koleksi ber-`tenant_id`).
- Platform: React Native (Expo Router SDK 57) + Web (React Native Web) + FastAPI + MongoDB.
- Tema: Soft Purple (#A855F7). Bahasa UI: Indonesia. Font: Poppins (judul), Inter (body).

## 2. Arsitektur & Stack
- Frontend: Expo Router (file-based, 38 layar di app/ + dashboard/), theme.ts (light/dark),
  WebView (Google Maps), Agora (live), React Query, Socket.IO client, expo-notifications (push).
- Backend: FastAPI (`/app/backend/server.py`), Motor (MongoDB), Socket.IO (chat/notifikasi),
  Emergent Object Storage (foto), threadpool untuk I/O storage.
- Integrasi: Biteship (kurir, LIVE), Google Maps (geocoding/pinpoint), Emergent LLM (AI produk &
  enhance foto), Emergent Object Storage, Emergent Google Auth, Agora (live), Emergent Push.

## 3. Fitur Utama (status: aktif)
- Admin: CRUD produk (+variasi gaya Shopee s/d 2 grup)/pelanggan/pesanan, profil toko, alamat toko
  (map), live shopping, broadcast promo (push), pengaturan ongkir (toggle kurir + subsidi).
- Analitik toko: rekap penjualan otomatis (pesanan selesai), pendapatan bersih (setelah ongkir + fee
  platform), produk terlaris, pengunjung (total dilihat + login + aktivitas terbaru).
- Voucher diskon: per-produk (harga dicoret) + kode voucher. Tipe: **persen** (diskon subtotal %),
  **nominal** (potongan Rp), dan **ongkir_persen** (diskon ongkir % dengan batas maks opsional).
  Min belanja, kuota, kadaluarsa. Platform fee % (adjustable, siap superadmin multi-tenant).
- Etalase gaya Shopee: "Terjual X · Dilihat Y", **rata-rata bintang + jumlah ulasan**, badge diskon,
  harga normal dicoret, range harga variasi.
- Review: bintang kualitas produk (1-5) + **bintang kepuasan terpisah** (Pelayanan & Pengiriman) +
  komentar + foto. Rata-rata ditampilkan di etalase & detail produk. Review hanya saat status selesai.
- Buyer: storefront, keranjang (variation-aware), checkout (Biteship rates + estimasi + asuransi +
  Google Maps pinpoint + GPS), review+foto, lacak resi live.
- Pengiriman: Biteship end-to-end LIVE (rates → auto-booking saat "Kirim" → tracking live), webhook
  status (delivered → selesai, cancelled → dibatalkan). Berat asli produk (bukan hardcode 500g).
  Kurir: gojek, grab (instan), lalamove, jne, jnt, lion, ninja, paxel, **pos** (Pos Indonesia).
  Payload order kirim origin/destination_postal_code + courier_insurance saat pembeli bayar asuransi;
  resi self-heal (ambil AWB terbaru tiap tracking dibuka). Admin: tombol lihat payload Biteship.
- Live shopping: state via MongoDB polling (bukan socket in-memory — aman multi-worker), chat realtime,
  tamu+auto-greeting, moderasi (pin/mute/kick), rekap + transkrip.
- Push notifications (Emergent-managed): chat buyer↔admin + broadcast promo. Deep-link tap → layar
  tujuan (warm + cold-start). HANYA jalan di build HP asli + butuh Google Service Account JSON saat build.

## 4. Endpoint API Penting (prefix /api)
- Auth: POST /auth/login-whitelist, /auth/register-whitelist, /auth/session (Google), /auth/me, PUT /me
- Produk: GET /products, GET /products/{id}, POST /products/{id}/view, (admin) POST/PUT/DELETE /admin/products
- Voucher: GET/POST/PUT/DELETE /admin/vouchers, POST /voucher/validate
- Order: POST /orders, GET /orders/{id}, GET /orders/{id}/track, PUT /orders/{id}/status, POST /admin/orders/{id}/ship
- Shipping: POST /shipping/rates, GET/PUT /admin/shipping-settings, POST /biteship/webhook
- Analitik: GET /admin/analytics, GET/PUT /admin/platform-settings
- Live: GET /live/current, /live/feed, POST /live/start|stop|chat|react|presence|pin|mute|kick|feature
- Push: POST /register-push, POST/GET /admin/broadcast, GET /notifications
- Lokasi: GET/POST/PUT /admin/locations, GET/POST/PUT/DELETE /me/addresses
- Download: GET /download/web.zip, /download/app.apk, /download/backup.zip, /download/db-dump.zip

## 5. Koleksi MongoDB (snapshot preview/dev saat audit)
users(18), user_sessions, products(32), product_views(13), orders(59), vouchers(1),
platform_settings(1), store_settings(1), locations(5), user_addresses, profil_admin(1),
chats(42), notifications, live_shows(43), live_state(1), live_messages, live_reactions,
live_presence, ongkir_manual(4 — legacy, tak dipakai checkout).

## 6. Variabel Lingkungan (NAMA saja — nilai TIDAK disertakan di backup)
- backend/.env: MONGO_URL, DB_NAME, BITESHIP_API_KEY (LIVE), GOOGLE_MAPS_API_KEY, EMERGENT_LLM_KEY,
  AGORA_APP_ID/CERT, EMERGENT_PUSH_KEY (placeholder → diisi deployer), EMERGENT_* (auth/storage).
- frontend/.env: EXPO_PUBLIC_BACKEND_URL, EXPO_PACKAGER_* (JANGAN diubah — dipakai preview).

## 7. Catatan Keamanan Backup
File .env dengan nilai rahasia DIKECUALIKAN dari bundle backup. Sertakan kembali kunci API
secara manual saat restore. Biteship memakai kunci **LIVE** (transaksi nyata saat admin klik "Kirim").
Di dump DB, hash password & session token disensor pada file JSON (BSON tetap utuh untuk restore).

## 8. Isi Bundle Backup (.zip)
- backend/ (server.py, requirements.txt, tests/, templates, static_downloads kecuali biner) — tanpa venv & __pycache__
- frontend/app, frontend/src, frontend/assets, package.json, app.json, tsconfig, metro.config, web/
- memory/ (PRD.md, test_credentials.md), test_result.md, BASELINE_AUDIT.md, landing/
- DIKECUALIKAN: node_modules, .git, venv, dist, *.apk, *.zip, .env (rahasia), __pycache__

## 9. Tiga Jenis Backup yang Tersedia
1. **Baseline Audit Report** — dokumen ini (`BASELINE_AUDIT.md`).
2. **MongoDB Data Dump** — `GET /api/download/db-dump.zip` (BSON mongodump + JSON readable + RESTORE_DB.md).
3. **Full Code Backup** — `GET /api/download/backup.zip` (seluruh source code, tanpa rahasia & biner).
