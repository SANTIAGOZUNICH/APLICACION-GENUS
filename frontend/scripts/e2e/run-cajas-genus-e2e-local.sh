#!/usr/bin/env bash
# E2E (Chromium real): CAJAS GENUS — ingreso de Depósito, pestaña de Administración, alerta de stock crítico (≤300), notificación y actualización
# automática sin recargar. Entorno DESCARTABLE.
#   GENUS_E2E_PRODUCTION_BUILD=1 bash scripts/e2e/run-cajas-genus-e2e-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/cajas-genus-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
