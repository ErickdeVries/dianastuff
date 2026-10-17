# Dianastuff repository guidance

These instructions apply to the whole repository and are intended for local and Codex web work.

## Current architecture

- Web: Expo web export hosted on Cloudflare Pages (`www.dianastuff.com`).
- API and Socket.IO: `https://dianastuff.helipod.app`.
- Database: MongoDB Atlas, database `dianastuff`.
- Android application id: `com.dianastuff.app`.

## Safety boundaries

- Never commit secrets, `.env` files, MongoDB dumps, APKs, signing keys, service-account credentials, or API tokens.
- Keep Biteship, 9Router/OpenAI-compatible, MongoDB, S3, Agora, and push credentials server-side.
- Do not change Android signing, package/application id, or versioning unless the task explicitly requests it.
- Preserve Google Login behavior and the Helipod API integration unless the task explicitly requests a migration.
- Do not deploy to Cloudflare, Helipod, MongoDB Atlas, or an app store unless explicitly requested.
- Do not modify the separate KULPROY project from this repository.

## Setup

Run `bash scripts/codex-setup.sh` from the repository root. The script installs the locked frontend dependencies and, by default, creates `.venv` and installs backend dependencies. Set `DIANASTUFF_SKIP_BACKEND=1` for frontend-only work.

Runtime configuration belongs in the environment or Codex secret store, never in tracked files. Important variable names are:

- Frontend: `EXPO_PUBLIC_BACKEND_URL`
- Backend required: `MONGO_URL`, `DB_NAME`
- Backend integrations as needed: `BITESHIP_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `AI_VISION_MODEL`, `AI_IMAGE_MODEL`, `STORAGE_PROVIDER`, `STORAGE_DIR`, `S3_ENDPOINT_URL`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `EMERGENT_PUSH_KEY`

## Verification

- Frontend lint: `cd frontend && yarn lint`
- Web export: `cd frontend && EXPO_PUBLIC_BACKEND_URL=https://dianastuff.helipod.app yarn export:web`
- AI compatibility test: `python -m pytest backend/tests/test_ai_9router_compat.py`

Web exports must retain the SPA fallback file `frontend/dist/_redirects` containing `/* /index.html 200`. Avoid tests that mutate production services; use mocks or dedicated test data unless production verification is explicitly authorized.
