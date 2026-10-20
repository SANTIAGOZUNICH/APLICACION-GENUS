#!/usr/bin/env bash
# E2E local (Chromium real, escritorio + tablet táctil): filas en blanco al final de Stock MP e Ingresos MP.
#   GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:mp-filas-vacias    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-filas-vacias-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
