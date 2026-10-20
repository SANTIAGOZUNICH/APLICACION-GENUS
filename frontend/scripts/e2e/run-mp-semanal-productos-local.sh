#!/usr/bin/env bash
# E2E del Control semanal de MP por producto (tablet Android emulada). Postgres descartable, build de producción.
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_PRODUCTION_BUILD=1 GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-semanal-productos-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
