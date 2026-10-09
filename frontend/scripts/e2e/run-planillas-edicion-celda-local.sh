#!/usr/bin/env bash
# E2E (Chromium real) de edición DIRECTA en la celda en las 7 planillas de Depósito y Materias Primas, con la
# preferencia global vieja «Ver como lista» ya guardada (condición del bug de Production) y pantalla de 1440 px.
# Mismo entorno DESCARTABLE que run-semanas-mi-trabajo-db-local.sh. Con GENUS_E2E_PRODUCTION_BUILD=1 usa next build + start.
#
#   GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:planillas-celda    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/planillas-edicion-celda-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
