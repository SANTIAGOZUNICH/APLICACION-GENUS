#!/usr/bin/env bash
# E2E de la activación de la cuenta de Administración desde el navegador (tablet). Postgres descartable, build de producción.
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_SUPERADMIN_EMAIL=e2e-direccion@genus.test GENUS_E2E_FAKE_BLOB_TOKEN=1 GENUS_E2E_PRODUCTION_BUILD=1 GENUS_E2E_FAKE_LIVE_SYNC=1 GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/admin-activation-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
