#!/usr/bin/env bash
# E2E (Chromium real) de la OE automática con fórmula y lotes, permisos reales y base DESCARTABLE.
#   GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:oe-automatica    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/oe-automatica-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
