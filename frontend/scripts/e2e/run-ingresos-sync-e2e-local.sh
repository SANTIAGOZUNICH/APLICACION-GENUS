#!/usr/bin/env bash
# E2E (Chromium real): sincronización automática de las planillas de Ingresos ME / MP entre dos sesiones. Entorno DESCARTABLE.
#   GENUS_E2E_PRODUCTION_BUILD=1 bash scripts/e2e/run-ingresos-sync-e2e-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/ingresos-sync-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
