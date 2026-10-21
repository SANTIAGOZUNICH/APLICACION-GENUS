#!/usr/bin/env bash
# E2E local (Chromium) del filtro TODAS | ENVASADO | ELABORACIÓN en ENTREGAS (calendario). Base DESCARTABLE.
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/entregas-sector-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
