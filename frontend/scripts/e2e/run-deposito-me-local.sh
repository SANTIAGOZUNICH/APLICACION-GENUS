#!/usr/bin/env bash
# E2E local (Chromium real) de Depósito ME como planillas editables (Etapa 2): mismo entorno DESCARTABLE que
# run-semanas-mi-trabajo-db-local.sh (Postgres nuevo, login real; nunca Google, Neon ni Production). Capturas en $OUT.
#
#   npm run test:e2e:deposito-me    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/deposito-me-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
