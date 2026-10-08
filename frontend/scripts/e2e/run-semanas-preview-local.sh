#!/usr/bin/env bash
# Corre la vista de Semanas EXACTAMENTE con la fuente de Preview (copia XLSX incluida, solo lectura), sin Google ni base.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ -n "${VERCEL:-}" || -n "${VERCEL_ENV:-}" || "${GENUS_ENV:-}" == "production" ]]; then echo "[semanas-preview] ABORTADO: solo local." >&2; exit 1; fi
PORT="${GENUS_E2E_PORT:-3230}"; LOG="$(mktemp)"
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development GENUS_DATA_MODE=demo NEXT_PUBLIC_GENUS_DATA_MODE=demo \
  GENUS_AUTH_ALLOW_TEST_HEADERS=1 GENUS_SEMANAS_PREVIEW_SOURCE=1 setsid npx next dev -p "$PORT" >"$LOG" 2>&1 &
PID=$!
trap 'kill -- "-$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true; rm -f "$LOG"' EXIT
for _ in $(seq 1 60); do curl -fsS "http://localhost:$PORT/login" >/dev/null 2>&1 && break; sleep 1; done
BASE="http://localhost:$PORT" node scripts/e2e/semanas-preview-check.mjs
