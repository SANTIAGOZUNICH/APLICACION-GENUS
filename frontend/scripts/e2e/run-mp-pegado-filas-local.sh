#!/usr/bin/env bash
# E2E local: pegar varias filas de Excel en las filas en blanco de Ingresos MP.
#   GENUS_E2E_PRODUCTION_BUILD=1 bash scripts/e2e/run-mp-pegado-filas-local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-pegado-filas-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
