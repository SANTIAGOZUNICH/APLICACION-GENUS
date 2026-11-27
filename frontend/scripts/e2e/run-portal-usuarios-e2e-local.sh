#!/usr/bin/env bash
# E2E del Portal de Clientes: usuario + contraseña, aislamiento, actualización automática y móvil (Chromium, build de producción).
#
#   npm run test:e2e:portal-usuarios    (desde frontend/)
export GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/portal-usuarios-validate.mjs
exec bash "$(dirname "$0")/run-portal-e2e-local.sh"
