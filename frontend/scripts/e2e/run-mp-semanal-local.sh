#!/usr/bin/env bash
# E2E local (Chromium real, escritorio + TABLET) del Control semanal de MP: disponibilidad real contra el inventario.
# Mismo entorno DESCARTABLE que run-semanas-mi-trabajo-db-local.sh (Postgres nuevo; nunca Google/Neon/Production).
#   bash scripts/e2e/run-mp-semanal-local.sh   (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/mp-semanal-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
