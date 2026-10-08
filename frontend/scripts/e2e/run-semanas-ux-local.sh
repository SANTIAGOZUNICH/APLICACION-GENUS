#!/usr/bin/env bash
# Validación UX (calendario operativo, prioridades, Modo TV) contra la COPIA LOCAL del libro (nunca Google, nunca Neon).
#   npm run test:e2e:semanas-ux            (desde frontend/; deja capturas en $OUT, por defecto /tmp/semanas-visual)
# Requisitos: ../SEMANAS 2026.xlsx (copia local) y Chromium de Playwright (o GENUS_E2E_CHROMIUM_PATH).
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ -n "${VERCEL:-}" || -n "${VERCEL_ENV:-}" || "${GENUS_ENV:-}" == "production" ]]; then
  echo "[semanas-visual] ABORTADO: nunca corre en Vercel ni en producción." >&2; exit 1
fi
XLSX="${GENUS_SEMANAS_FIXTURE_XLSX:-$PWD/../SEMANAS 2026.xlsx}"
[[ -f "$XLSX" ]] || { echo "[semanas-visual] No encuentro la copia local: $XLSX" >&2; exit 1; }
PORT="${GENUS_E2E_PORT:-3260}"
LOG="$(mktemp)"
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development GENUS_DATA_MODE=demo NEXT_PUBLIC_GENUS_DATA_MODE=demo \
  GENUS_AUTH_ALLOW_TEST_HEADERS=1 GENUS_SEMANAS_FIXTURE_XLSX="$XLSX" SEMANAS_TODAY_OVERRIDE=2026-05-06 \
  SEMANAS_WRITEBACK=1 SEMANAS_WRITEBACK_SPREADSHEET_IDS=fixture-semanas-2026 \
  setsid npx next dev -p "$PORT" >"$LOG" 2>&1 &
PID=$!
trap 'kill -- "-$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true; rm -f "$LOG"' EXIT
for _ in $(seq 1 60); do curl -fsS "http://localhost:$PORT/login" >/dev/null 2>&1 && break; sleep 1; done
BASE="http://localhost:$PORT" node scripts/e2e/semanas-ux-validate.mjs
