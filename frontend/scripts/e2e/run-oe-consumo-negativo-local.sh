#!/usr/bin/env bash
# E2E local (Chromium real) del descuento de MP en OE (siempre, también en negativo) y la tabla «Consumo de Materias Primas».
# Base DESCARTABLE (login real; nunca Google, Neon ni Production).
#
#   npm run test:e2e:oe-consumo-negativo    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/oe-consumo-negativo-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
