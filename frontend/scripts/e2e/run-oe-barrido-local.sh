#!/usr/bin/env bash
# E2E local: barrido de secciones por sector y dispositivo (escritorio, tablet, celular). npm run test:e2e:barrido
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/oe-barrido-secciones-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
