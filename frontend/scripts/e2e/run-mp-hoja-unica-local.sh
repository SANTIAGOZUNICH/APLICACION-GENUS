#!/usr/bin/env bash
# E2E local (Chromium real) de Materias Primas como HOJA ÚNICA con orden de carga persistente: mismo entorno DESCARTABLE
# que run-semanas-mi-trabajo-db-local.sh (Postgres nuevo, login real; nunca Google, Neon ni Production). Capturas en $OUT.
#
#   flock -w 3600 /tmp/e2e.lock npm run test:e2e:mp-hoja-unica    (desde frontend/; usa los puertos 443, 3280 y 55432)
#
# Siempre con build de producción (GENUS_E2E_PRODUCTION_BUILD=1): los números de rendimiento en `next dev` no sirven.
set -euo pipefail
cd "$(dirname "$0")/../.."
export GENUS_E2E_PRODUCTION_BUILD=1
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-hoja-unica-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
