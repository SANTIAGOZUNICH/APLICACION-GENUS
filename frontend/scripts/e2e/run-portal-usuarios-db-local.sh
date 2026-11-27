#!/usr/bin/env bash
# Portal de Clientes — usuario + contraseña, aislamiento, revocación, bloqueo y estados comerciales contra un Postgres DESCARTABLE real.
#
#   npm run test:e2e:portal-usuarios-db    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VITEST_FILES="src/integration/portal-usuarios.db.integration.test.ts" exec bash scripts/e2e/run-semanas-priorities-db-local.sh
