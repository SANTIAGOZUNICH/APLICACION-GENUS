#!/usr/bin/env bash
# Portal de Clientes — caso «GENUS TEST» con el flujo operativo REAL + push service local (VAPID/aes128gcm reales) contra Postgres DESCARTABLE.
#
#   npm run test:e2e:portal-real-flow-db    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VITEST_FILES="src/integration/portal-real-flow.db.integration.test.ts" exec bash scripts/e2e/run-semanas-priorities-db-local.sh
