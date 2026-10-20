#!/usr/bin/env bash
# E2E local (Chromium real, escritorio + tablet): columnas, filtros/orden, buscar y reemplazar, cola persistente, tipo de movimiento.
#   GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:mp-planilla-vista    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-planilla-vista-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
