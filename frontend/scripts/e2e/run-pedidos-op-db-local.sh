#!/usr/bin/env bash
# OP correlativo automático de Pedidos contra un Postgres DESCARTABLE real (concurrencia). Nunca Neon ni Production.
#
#   npm run test:e2e:pedidos-op-db    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VITEST_FILES="src/integration/pedidos-op-auto.db.integration.test.ts" exec bash scripts/e2e/run-semanas-priorities-db-local.sh
