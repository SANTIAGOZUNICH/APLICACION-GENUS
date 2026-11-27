#!/usr/bin/env bash
# E2E del service worker interno: no recarga la pestaña sola (Chromium, build de producción).
#   npm run test:e2e:pwa-reload    (desde frontend/)
export GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/pwa-reload-validate.mjs
exec bash "$(dirname "$0")/run-portal-e2e-local.sh"
