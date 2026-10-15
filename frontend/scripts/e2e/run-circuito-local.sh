#!/usr/bin/env bash
# E2E (Chromium real, base DESCARTABLE) del circuito operativo SIN Calidad: Elaboración→Envasado, Codificado, entregas
# parciales, permisos, notificaciones a Producción, pendientes de Calidad reubicados y capturas por dispositivo.
#
#   flock -w 3600 /tmp/e2e.lock npm run test:e2e:circuito    (desde frontend/; usa los puertos 443, 3280 y 55432)
#   GENUS_E2E_PRODUCTION_BUILD=1 ...                          (build de producción en vez de `next dev`)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_FAKE_LIVE_SYNC=1 GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/circuito-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
