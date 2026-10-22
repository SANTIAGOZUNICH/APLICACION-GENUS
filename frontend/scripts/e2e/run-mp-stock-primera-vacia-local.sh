#!/usr/bin/env bash
# E2E local (Chromium): eliminar caso real Stock MP: nuevo ingreso en la primera fila vacía tras la última escrita. Base DESCARTABLE.
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-stock-primera-vacia-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
