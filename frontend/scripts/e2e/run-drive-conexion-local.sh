#!/usr/bin/env bash
# E2E (Chromium real) del panel «Conexión con Google Drive» y de la causa de OE sin fórmula. Base DESCARTABLE, sin Google.
#   GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:drive-conexion    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/drive-conexion-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
