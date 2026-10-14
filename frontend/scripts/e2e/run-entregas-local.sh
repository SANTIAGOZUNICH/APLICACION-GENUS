#!/usr/bin/env bash
# E2E local (Chromium real) de Entregas: calendario, vínculo con trabajos, estados, permisos y responsive.
# Mismo entorno DESCARTABLE que run-semanas-mi-trabajo-db-local.sh (Postgres nuevo, login real; nunca Google, Neon ni Production).
#
#   npm run test:e2e:entregas    (desde frontend/; con GENUS_E2E_PRODUCTION_BUILD=1 usa un build de producción)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/entregas-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
