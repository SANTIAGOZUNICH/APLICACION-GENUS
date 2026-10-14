#!/usr/bin/env bash
# E2E (Chromium real, base DESCARTABLE) del Dashboard Operativo: números de pantalla vs. cálculo independiente por SQL,
# permisos por sector, filtros, semáforo/objetivos con auditoría y capturas en escritorio/tablet/celular.
#
#   flock -w 3600 /tmp/e2e.lock npm run test:e2e:dashboard    (desde frontend/; usa los puertos 443 y 3280)
#   GENUS_E2E_PRODUCTION_BUILD=1 ...                            (build de producción en vez de `next dev`)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/dashboard-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
