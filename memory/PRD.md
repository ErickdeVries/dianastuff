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
  POST /api/auth/logout. Startup seeds profil_admin (WA 085312812452) + admin/admin123.
- Frontend: Login screen (2 tabs, banner+logo header, segmented control, Google button,
  whitelist form, sticky WhatsApp FAB with empty-number fallback), Register screen (pending
  success state), Home screen (welcome + role badge + logout), root-layout auth gate.
- Verified by testing agent: 12/12 backend tests + full frontend flow, no bugs.

## Backlog (prioritized)
- **P0**: Admin approval UI (list pending buyers, approve/reject).
- **P1**: Store profile editor for admin (nama_toko, logo, banner, rekening, WhatsApp).
- **P1**: Product catalog (list + detail) — `products` collection.
- **P2**: Cart & orders (`orders`), WhatsApp checkout with bank transfer details.
- **P2**: In-app chat (`chats`) buyer ↔ admin.

## Next Tasks
1. Admin approval dashboard.
2. Store profile editor (logo/banner upload via Object Storage).
3. Product catalog screens.
