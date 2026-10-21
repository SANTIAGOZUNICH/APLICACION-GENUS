#!/usr/bin/env bash
# E2E local (Chromium): ENTREGAR OE no se bloquea por datos/stock de MP. Base DESCARTABLE.
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/oe-entrega-sin-bloqueo-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
