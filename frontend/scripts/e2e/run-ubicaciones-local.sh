#!/usr/bin/env bash
# E2E local (Chromium real) de DEPÓSITO › UBICACIONES: mapa, búsqueda, asignar, traslado parcial, liberar, historial, consulta en Envasado,
# sincronización entre sesiones y celular. Base DESCARTABLE (login real; nunca Google, Neon ni Production).
#
#   npm run test:e2e:ubicaciones    (desde frontend/)    [GENUS_E2E_PRODUCTION_BUILD=1 para build de producción]
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/ubicaciones-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
