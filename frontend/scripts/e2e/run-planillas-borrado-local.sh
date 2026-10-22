#!/usr/bin/env bash
# E2E local (Chromium): Backspace/Delete/borrado masivo/filas completas en las cinco planillas. Base DESCARTABLE.
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/planillas-borrado-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
