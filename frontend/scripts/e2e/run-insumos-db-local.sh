#!/usr/bin/env bash
# Pruebas de integración del módulo INSUMOS contra un Postgres DESCARTABLE real (migraciones reales; nunca Neon ni Production).
#
#   npm run test:e2e:insumos-db    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VITEST_FILES="src/integration/insumos.db.integration.test.ts src/integration/insumos-stock.db.integration.test.ts" exec bash scripts/e2e/run-semanas-priorities-db-local.sh
