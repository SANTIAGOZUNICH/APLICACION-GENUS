#!/usr/bin/env bash
# E2E local (Chromium real) de «Producción edita la planificación desde las tarjetas»: mismo entorno DESCARTABLE que
# run-semanas-mi-trabajo-db-local.sh (Postgres nuevo, login real, planificación nativa, copia local de SEMANAS 2026;
# nunca Google, Neon ni Production). Deja capturas en $OUT.
#
#   npm run test:e2e:produccion-edicion    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/produccion-edicion-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
