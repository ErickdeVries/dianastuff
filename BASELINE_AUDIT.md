# dianastuff — Baseline Audit & Backup Manifest

Tanggal audit: 2026-06 (fork)
Versi APK terbaru: **1.0.8**

## 1. Ringkasan Aplikasi
- Nama: **dianastuff** — e-commerce single-tenant (siap jadi multi-tenant).
- Platform: React Native (Expo Router) + Web (React Native Web) + FastAPI + MongoDB.
- Tema: Soft Purple (#A855F7). Bahasa UI: Indonesia.

## 2. Arsitektur & Stack
- Frontend: Expo Router (file-based), NativeWind-style via theme.ts, WebView (Google Maps), Agora (live).
- Backend: FastAPI (`/app/backend/server.py`), Motor (MongoDB), Socket.IO (chat/notifikasi).
- Integrasi: Biteship (kurir), Google Maps (geocoding/pinpoint), Emergent LLM (AI produk & enhance foto),
  Emergent Object Storage (foto), Emergent Google Auth, Agora (live streaming).

## 3. Fitur Utama (status: aktif)
- Admin: CRUD produk/pelanggan/pesanan, profil toko, alamat toko (map), live shopping.
- Analitik toko: rekap penjualan otomatis (pesanan selesai), pendapatan bersih (setelah ongkir + fee
  platform), produk terlaris, pengunjung (total dilihat + login + aktivitas terbaru).
- Voucher diskon: per-produk (harga dicoret) + kode voucher di checkout (persen/nominal, min belanja,
  kuota, kadaluarsa). Platform fee % (adjustable, siap superadmin multi-tenant).
- Etalase gaya Shopee: "Terjual X · Dilihat Y", badge diskon, harga normal dicoret.
- Buyer: storefront, keranjang, checkout (Biteship rates + Google Maps pinpoint + GPS), review+foto.
- Pengiriman: Biteship end-to-end (rates → auto-booking saat "Kirim" → tracking live), webhook status
  (delivered → selesai, cancelled → dibatalkan).
- Live shopping: state via MongoDB polling, chat realtime, tamu+auto-greeting.

## 4. Endpoint API Penting (prefix /api)
- Auth: POST /auth/login-whitelist, PUT /me
- Produk: GET /products, GET /products/{id}, POST /products/{id}/view, (admin) POST/PUT/DELETE /admin/products
- Voucher: GET/POST/PUT/DELETE /admin/vouchers, POST /voucher/validate
- Order: POST /orders, GET /orders/{id}, PUT /orders/{id}/status, POST /admin/orders/{id}/ship
- Shipping: POST /shipping/rates, POST /biteship/webhook
- Analitik: GET /admin/analytics, GET/PUT /admin/platform-settings
- Download: GET /download/web.zip, /download/app.apk, /download/backup.zip

## 5. Koleksi MongoDB
users, user_sessions, products, product_views, orders, vouchers, platform_settings,
locations, user_addresses, reviews, customers, shop_profile, live_* (state/chat).

## 6. Variabel Lingkungan (NAMA saja — nilai TIDAK disertakan di backup)
- backend/.env: MONGO_URL, DB_NAME, BITESHIP_API_KEY, GOOGLE_MAPS_API_KEY, EMERGENT_LLM_KEY,
  AGORA_APP_ID/CERT, EMERGENT_* (auth/storage).
- frontend/.env: EXPO_PUBLIC_BACKEND_URL, EXPO_PACKAGER_* (JANGAN diubah).

## 7. Catatan Keamanan Backup
File .env dengan nilai rahasia DIKECUALIKAN dari bundle backup. Sertakan kembali kunci API
secara manual saat restore. Biteship masih memakai kunci TEST hingga aktivasi live disetujui.

## 8. Isi Bundle Backup (.zip)
- backend/ (server.py, requirements.txt, tests/, templates) — tanpa venv & __pycache__
- frontend/app, frontend/src, frontend/assets, package.json, app.json, tsconfig, metro.config
- memory/ (PRD.md, test_credentials.md), test_result.md, BASELINE_AUDIT.md
- DIKECUALIKAN: node_modules, .git, venv, dist_web, *.apk, *.zip, .env (rahasia), __pycache__
