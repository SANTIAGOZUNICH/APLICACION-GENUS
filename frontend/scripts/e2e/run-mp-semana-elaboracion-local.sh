#!/usr/bin/env bash
# E2E (Chromium real): Materias Primas → «Semana de Elaboración» (solo lectura). Entorno DESCARTABLE.
#   GENUS_E2E_PRODUCTION_BUILD=1 GENUS_E2E_FAKE_LIVE_SYNC=1 bash scripts/e2e/run-mp-semana-elaboracion-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-semana-elaboracion-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
