#!/usr/bin/env bash
# E2E del Portal de Clientes — NOTIFICACIONES con el circuito operativo REAL (Chromium con SERVICE WORKER real, build de producción, Postgres DESCARTABLE).
#   Cada cambio de estado entra por los endpoints REALES que usan las pantallas de los sectores (producción de pedidos, asignación, envasado,
#   live-sync/operations, disponibilidad); el worker real envía Web Push con VAPID/aes128gcm a un push service HTTPS LOCAL que valida y descifra, y
#   reenvía el mensaje descifrado al SERVICE WORKER REAL del navegador (CDP ServiceWorker.deliverPushMessage), que muestra la notificación y manda
#   el acuse. NO prueba la recepción física en un celular (APNs/FCM). Envío global APAGADO: solo el cliente de prueba tiene «envío real».
#
#   npm run test:e2e:portal-notificaciones    (desde frontend/)
set -euo pipefail
cd "$(dirname "$0")/../.."
eval "$(node -e 'const w=require("web-push");const k=w.generateVAPIDKeys();console.log(`export GENUS_E2E_VAPID_PUBLIC_KEY=${k.publicKey} GENUS_E2E_VAPID_PRIVATE_KEY=${k.privateKey}`)')"
export GENUS_E2E_FAKE_LIVE_SYNC=1
export GENUS_E2E_VALIDATE_SCRIPT=scripts/e2e/portal-notificaciones-validate.mjs
exec bash scripts/e2e/run-portal-e2e-local.sh
