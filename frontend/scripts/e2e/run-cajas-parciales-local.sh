#!/usr/bin/env bash
# E2E (Chromium real): cada entrega parcial de Envasado conserva SU embalaje y Producción lo muestra. Entorno DESCARTABLE.
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_FAKE_LIVE_SYNC=1 GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/cajas-parciales-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
