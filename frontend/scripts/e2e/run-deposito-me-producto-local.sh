#!/usr/bin/env bash
# E2E local (Chromium real) de PRODUCTO + DIFERENCIA en Stock e Ingresos ME (tablet): mismo entorno DESCARTABLE que
# run-semanas-mi-trabajo-db-local.sh (Postgres nuevo, login real; nunca Google, Neon ni Production). Capturas en $OUT.
#
#   npm run test:e2e:deposito-me-producto    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/deposito-me-producto-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
