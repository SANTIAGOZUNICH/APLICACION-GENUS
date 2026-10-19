#!/usr/bin/env bash
# E2E local (Chromium real, TABLET) de las HOJAS DE ELABORACIÓN (tambores/ollas) dentro de una OE. Base DESCARTABLE.
#   npm run test:e2e:oe-hojas    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/oe-hojas-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
