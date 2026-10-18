#!/usr/bin/env bash
# E2E local de la LECTURA AUTOMÁTICA del remito con un Gemini SIMULADO (servidor local que imita la API REST de Gemini).
# Verifica el flujo completo de GENUS OS (subir foto → análisis automático → formulario completado → confirmar), NO la calidad de
# lectura de Gemini real. Entorno DESCARTABLE como run-semanas-mi-trabajo-db-local.sh (nunca Google, Neon ni Production).
#
#   npm run test:e2e:ingreso-remito-lectura    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
export INGRESO_REMITO_EXTRACTION=gemini
export GEMINI_API_KEY=e2e-clave-falsa-no-es-real
export INGRESO_REMITO_GEMINI_BASE_URL=http://127.0.0.1:4599
# Modelo configurado que YA NO EXISTE en el Gemini simulado: la lectura debe descubrir otro sola.
export INGRESO_REMITO_GEMINI_MODEL=gemini-2.0-flash-retirado
GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/ingreso-remito-lectura-validate.mjs exec bash scripts/e2e/run-semanas-mi-trabajo-db-local.sh
