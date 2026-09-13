# Diana Stuff

Aplikasi e-commerce single-tenant (React Native Expo + FastAPI + MongoDB) untuk toko **Diana Stuff**. Mendukung login Google & whitelist, dashboard admin (produk, pelanggan, pesanan, pengaturan toko), etalase & checkout pembeli, serta chat realtime (Socket.IO).

## Tech Stack
- **Frontend**: Expo (React Native) + Expo Router, React Query, Socket.IO client, react-native-webview
- **Backend**: FastAPI + Motor (MongoDB), Socket.IO (python-socketio), Emergent Object Storage untuk gambar
- **DB**: MongoDB

## Struktur
```
/app
├── backend/          # FastAPI (server.py) + .env
└── frontend/         # Expo app (app/ routes, src/ komponen & util)
```

## Menjalankan Backend
```bash
cd backend
pip install -r requirements.txt
# .env wajib berisi:
#   MONGO_URL=mongodb://localhost:27017
#   DB_NAME=test_database
#   EMERGENT_LLM_KEY=...            # untuk Object Storage upload gambar
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```
Semua route diawali `/api`. Socket.IO berjalan di path `/api/socket.io`.
Saat startup, data contoh otomatis di-seed (profil toko, 1 admin, 1 buyer, 3 produk baju).

## Menjalankan Frontend
```bash
cd frontend
yarn install
# .env wajib berisi:
#   EXPO_PUBLIC_BACKEND_URL=https://<host-backend-anda>
yarn start        # lalu tekan w (web) / scan QR untuk Expo Go
```

## Akun Demo (seed)
| Peran | Username | Password |
|-------|----------|----------|
| Admin | `admin`  | `admin123` |
| Buyer | `buyer`  | `buyer123` |

Login Gmail memakai Emergent Google OAuth (tanpa password aplikasi).

## Fitur Utama
- **Auth**: Login Gmail (Google) + Whitelist (username/password, daftar -> approval admin)
- **Admin Dashboard** (`/dashboard`, khusus admin): statistik, CRUD produk (upload s/d 5 foto), CRUD pelanggan, manajemen pesanan (ubah status, input resi), pengaturan toko (logo/banner/rekening/WA), chat.
- **Buyer**: etalase `/toko` (grid, cari, filter kategori) -> detail `/produk/[id]` (slider foto) -> keranjang `/keranjang` -> checkout 3 langkah `/checkout` (alamat, kurir + cek ongkir, transfer manual) -> `/order/[id]` (stepper status ala Shopee, konfirmasi bayar via WhatsApp, upload bukti, beri ulasan).
- **Chat realtime** (`/chat`) 1-1 admin <-> buyer via Socket.IO (teks + gambar).
- **WebView** (`/webview`) untuk membuka versi web `/toko`, `/produk/[id]`, `/checkout` di dalam app.

## Koleksi MongoDB
`users`, `profil_admin`, `products`, `orders`, `chats`, `ongkir_manual`, `user_sessions`

## Deploy
Gunakan tombol **Publish** pada platform Emergent untuk deploy backend + generate build iOS/Android. Jangan mengubah `frontend/eas.json` (dikelola platform) maupun variabel env yang dilindungi.
