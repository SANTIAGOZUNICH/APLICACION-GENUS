#!/usr/bin/env bash
# E2E local (Chromium real) de Envasado: Pendientes agrupado por pedido y Semana sin cambios. Base DESCARTABLE.
#
#   npm run test:e2e:envasado-agrupados    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/envasado-pendientes-agrupados-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
