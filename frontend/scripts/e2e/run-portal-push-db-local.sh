#!/usr/bin/env bash
# Portal de Clientes — notificaciones push / piloto / outbox contra un Postgres DESCARTABLE real (web-push siempre mockeado).
#
#   npm run test:e2e:portal-push-db    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VITEST_FILES="src/integration/portal-push.db.integration.test.ts" exec bash scripts/e2e/run-semanas-priorities-db-local.sh
