#!/usr/bin/env bash
# E2E (Chromium real, escritorio + tablet): Ingresos MP sin celdas bloqueadas (TOTAL / INGRESO Nº), ingreso → Stock MP
# automático, menú «Rellenar» (orden numérico / igual). Entorno DESCARTABLE.
#   GENUS_E2E_PRODUCTION_BUILD=1 bash scripts/e2e/run-mp-correccion-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-correccion-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
