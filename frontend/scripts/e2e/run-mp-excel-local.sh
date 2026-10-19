#!/usr/bin/env bash
# E2E local (Chromium real, escritorio + TABLET táctil) de Materias Primas «como Excel»: edición directa, borrado
# inmediato, pegar rangos, relleno arrastrando (series / copia), Deshacer-Rehacer, barras fijas, primera columna fija y
# eliminar filas. Mismo entorno DESCARTABLE que run-semanas-mi-trabajo-db-local.sh (Postgres nuevo; nunca Google/Neon/Production).
#
#   npm run test:e2e:mp-excel    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-excel-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
