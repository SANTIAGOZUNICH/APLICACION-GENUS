#!/usr/bin/env bash
# Portal de Clientes — vínculo por ID (pedidos/trabajos ⇄ cliente), backfill, aislamiento, firma en tiempo real y push contra un
# Postgres DESCARTABLE real.
#
#   npm run test:e2e:portal-vinculo-db    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VITEST_FILES="src/integration/portal-vinculo.db.integration.test.ts" exec bash scripts/e2e/run-semanas-priorities-db-local.sh
