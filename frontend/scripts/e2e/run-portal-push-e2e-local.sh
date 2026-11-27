#!/usr/bin/env bash
# E2E del Portal de Clientes — PWA + notificaciones push (Chromium, build de producción). Push siempre con stub: no envía nada real.
#
#   npm run test:e2e:portal-push    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
# Claves VAPID DESCARTABLES generadas en cada corrida (nunca se guardan ni se usan fuera del proceso de prueba).
eval "$(node -e 'const w=require("web-push");const k=w.generateVAPIDKeys();console.log(`export GENUS_E2E_VAPID_PUBLIC_KEY=${k.publicKey} GENUS_E2E_VAPID_PRIVATE_KEY=${k.privateKey}`)')"
export GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/portal-push-validate.mjs
exec bash scripts/e2e/run-portal-e2e-local.sh
