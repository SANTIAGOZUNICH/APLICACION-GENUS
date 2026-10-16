#!/usr/bin/env bash
# E2E (Chromium real) del MODO DEMOSTRACIÓN del Portal de Clientes: mismo entorno DESCARTABLE que run-portal-e2e-local.sh.
#
#   npm run test:e2e:portal-demo    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/portal-demo-validate.mjs exec bash scripts/e2e/run-portal-e2e-local.sh
