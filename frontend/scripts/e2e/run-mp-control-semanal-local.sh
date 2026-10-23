#!/usr/bin/env bash
# E2E local: Control semanal de MP como planilla automática, tablet + escritorio, base descartable.
#   GENUS_E2E_PRODUCTION_BUILD=1 bash scripts/e2e/run-mp-control-semanal-local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-control-semanal-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
