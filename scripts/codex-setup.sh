#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ "${DIANASTUFF_SKIP_BACKEND:-0}" != "1" ]]; then
  python -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r backend/requirements.txt
fi

cd frontend
npx --yes yarn@1.22.22 install --frozen-lockfile

echo "Dianastuff Codex environment is ready."
