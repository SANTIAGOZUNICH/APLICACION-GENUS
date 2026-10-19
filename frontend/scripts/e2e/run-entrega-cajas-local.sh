#!/usr/bin/env bash
# E2E local (Chromium, tablet) de la entrega con cajas de distintas cantidades. Base DESCARTABLE.
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_PRODUCTION_BUILD=1 GENUS_E2E_FAKE_LIVE_SYNC=1 GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/entrega-cajas-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
