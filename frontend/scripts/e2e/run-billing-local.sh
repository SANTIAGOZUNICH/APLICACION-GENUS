#!/usr/bin/env bash
# E2E de Control de facturación + alta de cuenta de Administración (Postgres descartable, build de producción, tablet).
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_FAKE_BLOB_TOKEN=1 GENUS_E2E_PRODUCTION_BUILD=1 GENUS_E2E_FAKE_LIVE_SYNC=1 GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/billing-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
