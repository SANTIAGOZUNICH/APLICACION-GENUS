#!/usr/bin/env bash
# E2E local (Chromium real, PC y tablet): ingresos = historial, stock = saldo, y Entregas Producción que descuentan stock.
# Mismo entorno DESCARTABLE que run-semanas-mi-trabajo-db-local.sh (nunca Google, Neon ni Production).
#   GENUS_E2E_PRODUCTION_BUILD=1 bash scripts/e2e/run-deposito-me-stock-entregas-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/deposito-me-stock-entregas-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
