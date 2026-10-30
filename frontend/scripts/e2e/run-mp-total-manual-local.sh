#!/usr/bin/env bash
# E2E (Chromium real): MP → Control semanal total (observaciones, reemplazo manual, selección/eliminación). Entorno DESCARTABLE.
#   GENUS_E2E_PRODUCTION_BUILD=1 bash scripts/e2e/run-mp-total-manual-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-total-manual-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
