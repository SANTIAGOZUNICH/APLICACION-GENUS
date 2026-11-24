#!/usr/bin/env bash
# E2E local (Chromium real) del módulo INSUMOS: formulario de 3 pasos en celular y Administración › INSUMOS.
# Base DESCARTABLE (login real; nunca Google, Neon ni Production).
#
#   npm run test:e2e:insumos    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/insumos-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
