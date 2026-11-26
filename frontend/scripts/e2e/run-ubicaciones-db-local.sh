#!/usr/bin/env bash
# Pruebas de integración de DEPÓSITO › UBICACIONES contra un Postgres DESCARTABLE real (migraciones reales; nunca Neon ni Production).
#
#   npm run test:e2e:ubicaciones-db    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VITEST_FILES="src/integration/ubicaciones.db.integration.test.ts" exec bash scripts/e2e/run-semanas-priorities-db-local.sh
