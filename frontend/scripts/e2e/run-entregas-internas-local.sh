#!/usr/bin/env bash
# E2E (Chromium real): Entregas internas — más de lo pedido, editar y cancelar. Entorno DESCARTABLE.
#   GENUS_E2E_PRODUCTION_BUILD=1 GENUS_E2E_FAKE_LIVE_SYNC=1 bash scripts/e2e/run-entregas-internas-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/entregas-internas-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
