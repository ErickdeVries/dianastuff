# Diana Stuff

Aplikasi e-commerce single-tenant berbasis Expo/React Native, FastAPI, dan MongoDB. Satu source frontend digunakan untuk web dan Android, dengan login Google/whitelist, dashboard admin, katalog, checkout, pesanan, unggah gambar, dan chat Socket.IO.

## Arsitektur aktif

- Web: Cloudflare Pages di `www.dianastuff.com`
- API dan Socket.IO: `https://dianastuff.helipod.app`
- Database: MongoDB Atlas, database `dianastuff`
- Android: Expo/EAS, application id `com.dianastuff.app`

Source ini berasal dari proyek Emergent, tetapi konfigurasi aktifnya sudah dimigrasikan. Referensi Emergent yang masih ada di kode hanya dipertahankan sebagai kompatibilitas/fallback dan bukan petunjuk deployment.

## Struktur

```text
backend/          FastAPI, Socket.IO, integrasi storage/Biteship/AI
frontend/         Expo Router untuk web dan Android
landing/          aset landing terkait proyek
scripts/          utilitas setup repository
```

## Setup lokal atau Codex web

```bash
bash scripts/codex-setup.sh
```

Untuk pekerjaan frontend saja:

```bash
DIANASTUFF_SKIP_BACKEND=1 bash scripts/codex-setup.sh
```

Masukkan konfigurasi runtime melalui environment variables atau secret store, jangan ke Git. Minimum backend adalah `MONGO_URL` dan `DB_NAME`. Frontend memakai `EXPO_PUBLIC_BACKEND_URL`.

## Menjalankan dan memeriksa frontend

```bash
cd frontend
EXPO_PUBLIC_BACKEND_URL=https://dianastuff.helipod.app yarn web
yarn lint
EXPO_PUBLIC_BACKEND_URL=https://dianastuff.helipod.app yarn export:web
```

Hasil export berada di `frontend/dist`. Skrip export menambahkan fallback SPA Cloudflare `/* /index.html 200`.

## Menjalankan backend

```bash
.venv/bin/uvicorn backend.server:app --host 0.0.0.0 --port 8001 --reload
```

Semua REST route aplikasi memakai prefix `/api`; Socket.IO memakai path `/api/socket.io`. Jangan menjalankan pengujian yang mengubah data production tanpa persetujuan eksplisit.

## Deployment

Deployment web, backend, database, dan Android dilakukan secara terpisah. Push ke `main` juga menjalankan workflow image backend ke GitHub Container Registry. Karena itu perubahan sebaiknya melalui branch dan review sebelum merge. Detail aturan kerja dan verifikasi tersedia di `AGENTS.md`.
