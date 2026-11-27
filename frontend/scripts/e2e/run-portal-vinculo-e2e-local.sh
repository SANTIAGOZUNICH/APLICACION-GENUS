#!/usr/bin/env bash
# E2E del Portal de Clientes — VÍNCULO POR ID (Chromium real, build de producción, Postgres DESCARTABLE, sin mocks en la vinculación).
#   Dirección crea cliente + acceso → Producción asigna un pedido desde el formulario real → el portal abierto lo muestra solo →
#   cambios de sector → avisos push (outbox simulada). Ver scripts/e2e/portal-vinculo-validate.mjs.
#
#   npm run test:e2e:portal-vinculo    (desde frontend/)
export GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/portal-vinculo-validate.mjs
exec bash "$(dirname "$0")/run-portal-e2e-local.sh"
