#!/usr/bin/env bash
# E2E visual (Chromium real): tarjeta flotante de la Vista mensual (opaca, legible, por encima, dentro de pantalla) en escritorio, tablet y celular.
#   GENUS_E2E_PRODUCTION_BUILD=1 GENUS_E2E_FAKE_LIVE_SYNC=1 bash scripts/e2e/run-vista-mensual-tarjeta-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/vista-mensual-tarjeta-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
