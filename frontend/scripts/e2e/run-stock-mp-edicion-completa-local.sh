#!/usr/bin/env bash
# E2E (Chromium real) de Stock MP con TODAS las columnas editables en la celda: usuario Materia Prima, fila existente de
# un ingreso confirmado, motivo dentro de la planilla, código/kg/stock código con libro mayor. Entorno DESCARTABLE (el
# mismo de run-semanas-mi-trabajo-db-local.sh). Con GENUS_E2E_PRODUCTION_BUILD=1 usa next build + start.
#
#   GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:stock-mp-completo    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/stock-mp-edicion-completa-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
