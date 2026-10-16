#!/usr/bin/env bash
# E2E (Chromium real) de «Listo para entregar» (disponibilidad explícita): mismo entorno DESCARTABLE que run-portal-e2e-local.sh.
#
#   npm run test:e2e:portal-disponibilidad    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/portal-disponibilidad-validate.mjs exec bash scripts/e2e/run-portal-e2e-local.sh
