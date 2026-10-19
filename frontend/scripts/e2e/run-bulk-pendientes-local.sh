#!/usr/bin/env bash
# E2E local (Chromium real, resolución de TABLET) de la selección múltiple y acciones masivas de «Pendientes de definir»:
# mismo entorno DESCARTABLE que run-semanas-mi-trabajo-db-local.sh (Postgres nuevo, login real, planificación nativa).
# Verifica estilos reales (fondo de fila seleccionada, contraste, alto de fila, barra sin tapar encabezados) y que
# eliminar / entregar / enviar a Codificado en grupo persistan en la base. Deja capturas en $OUT.
#
#   npm run test:e2e:bulk-pendientes    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/bulk-pendientes-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
