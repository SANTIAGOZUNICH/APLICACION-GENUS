# Portal de Clientes — auditoría del circuito de estado y notificaciones

Evidencia reproducible contra un Postgres DESCARTABLE con los servicios REALES de cada sector (sin mocks, sin UPDATE directos):
`src/integration/portal-notif-audit.db.integration.test.ts` (observa, con la configuración de producción: envío global APAGADO, cliente en piloto).
La salida de abajo es la de ANTES de corregir.

```
A) circuito completo (Producción → Elaboración → Envasado → Finalizar → «Marcar listo» → entrega parcial → total)
  portal: Pedido recibido → En elaboración → En envasado → En envasado → Listo → Listo → Entregado     outbox: TODO «SIMULADA»
B) Producción edita el ESTADO del pedido (pedido con trabajo en Envasado)
  «LISTO PARA ENTREGAR» → portal: En envasado      «ENTREGADO» → portal: En envasado
C) pedido sin trabajos, estado manual
  «LISTO PARA ENTREGAR» → En envasado              «ENTREGADO» → (NO SE MUESTRA)
```

## Etapa por etapa

| Etapa | Qué fallaba (causa raíz) | Corrección |
|---|---|---|
| Cambio real → estado del portal | (1)(2) El estado del pedido que edita Producción («LISTO PARA ENTREGAR», «ENTREGADO») se ignoraba si había trabajos, se mostraba como «En envasado» si no los había, y un pedido ENTREGADO sin trabajos DESAPARECÍA del portal. Solo contaban la marca de disponibilidad y las entregas. Además un «Rehacer» (`rework_requested_at`) con marca previa seguía figurando «Listo». (La hipótesis de que los trabajos entregados salen de las consultas «vivas» NO se confirmó: `LIVE` solo excluye borrados/cancelados; archivar la entrega tampoco los oculta.) | Una sola resolución (`buildOverview`, usada por el portal Y el detector de push): estado del pedido = vía real de Listo/Entregado; reproceso abierto detectado por `rework_requested_at`; pedidos entregados en sección «Entregados» con fecha; ETag cambia con cada transición. |
| Detección → evento | Sin hooks en entregas, estado del pedido, anular/rehacer/cancelar: dependía solo del cron. | `withPortalPush` en todas las rutas de escritura de sectores (live-sync/operations, work-items envasado/codificado/bulk, internal-deliveries, production-pedidos) con `after()` y try/catch; el cron `*/2` queda como red de seguridad. |
| Outbox → worker | (3) CAUSA PRINCIPAL: con el interruptor global APAGADO (valor por defecto) TODO evento quedaba «SIMULADA», también para el cliente de prueba: nunca se llamaba a web-push. Un reintento reenviaba también a los dispositivos que ya habían aceptado (duplicados). | Migración 0100: `real_send_enabled` por cliente («Envío REAL a este cliente (prueba)», solo Dirección, con confirmación); global OFF sigue simulando al resto. Reintento solo a los dispositivos pendientes. |
| Web Push → servicio push | Los errores se aplanaban: 401/403 (VAPID), 413, 429 no tenían tratamiento ni motivo visible. | Clasificación por código (2xx aceptado, 404/410 baja, 401/403 suscripción inválida, 413 permanente, 429 con `Retry-After`, 5xx reintento) guardada por dispositivo en `portal_push_deliveries`; suscripción con otra clave VAPID rechazada (409) y reparada sola en el cliente; `urgency: high`. |
| Service worker | Un `showNotification` fallido no tenía reintento; sin acuse; sin `pushsubscriptionchange`. | Handler robusto (JSON → texto → default, siempre en `waitUntil`, reintento mínimo), acuse a `/entregas/api/push/ack` (firmado por evento+dispositivo, sin datos) y re-suscripción automática. Verificado con el SW REAL de Chromium. |
| Diagnóstico | No se distinguía simulado/enviado ni aceptado/recibido; el cron sin ejecuciones no se avisaba. | Panel de Dirección y `GET /api/v1/portal-push-health` (solo Dirección): dispositivos y validez, SIMULADO vs ENVIADO, aceptado vs recepción comprobada, error y motivo, latido del cron (`sin ejecuciones recientes` > 5 min; el cron escribe el latido aun sin eventos). |

## Textos (exactos)
Recibido, Elaboración, Envasado, Listo, Entregado: ver `src/lib/portal/push/push-rules.ts` (`buildPushMessage`). Ya no se agrega la referencia del pedido al cuerpo.

## Qué NO se puede comprobar desde acá
Recepción física en un celular (FCM/APNs), ejecución real del cron en Vercel, y las claves VAPID/CRON_SECRET de producción.
