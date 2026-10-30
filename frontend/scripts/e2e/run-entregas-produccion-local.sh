#!/usr/bin/env bash
# E2E (Chromium real): Depósito → Entregas Producción como planilla. Entorno DESCARTABLE.
#   GENUS_E2E_PRODUCTION_BUILD=1 bash scripts/e2e/run-entregas-produccion-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/entregas-produccion-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
