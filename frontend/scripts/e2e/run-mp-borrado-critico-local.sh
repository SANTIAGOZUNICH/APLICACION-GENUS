#!/usr/bin/env bash
# E2E local (Chromium): eliminar Ingresos MP libremente y nuevas filas de Stock MP siempre al final. Base DESCARTABLE.
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-borrado-critico-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
