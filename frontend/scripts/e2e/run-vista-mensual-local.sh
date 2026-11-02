#!/usr/bin/env bash
# E2E (Chromium real): Vista mensual compartida (Premium | Masivo | Elaboración) en todos los sectores. Entorno DESCARTABLE.
#   GENUS_E2E_PRODUCTION_BUILD=1 GENUS_E2E_FAKE_LIVE_SYNC=1 bash scripts/e2e/run-vista-mensual-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/vista-mensual-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
