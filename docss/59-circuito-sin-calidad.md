# 59 — Circuito operativo sin Calidad

Rama `claude/circuito-sin-calidad`. Migración aditiva `0047_work_item_delivery_lines`.

## 1. El circuito nuevo

```
Producción asigna → Elaboración ──(Enviar a Envasado)──► Envasado Masivo / Premium
                                                          │
                                   ┌──────────────────────┴───────────────────────┐
                                   ▼                                              ▼
                      Enviar a Codificado (solo cantidad total)          Entregar (entrega final, con cajas)
                                   │
                                   ▼
                          Codificado ──► Entregar (entrega final automática)
```

- No hay aprobación de Calidad, bandeja de aprobados/rechazados ni "enviar a Calidad".
- `operational_status = revision` se reinterpreta como **terminado, pendiente de definir/entregar**. `completo` = Elaboración ya envió a Envasado.
- Producción y Dirección reciben una notificación persistida en cada traspaso y entrega (sección 6).

## 2. Cómo se retiró Calidad (sin perder historia)

- Se conservan TODAS las columnas `quality_*`, eventos, enum y CHECK. No hay DROP/UPDATE/DELETE en migraciones.
- Fuera de: barra lateral, sectores asignables, aprobaciones obligatorias, bandejas, notificaciones operativas a CALIDAD. `quality_decision` y `quality_annul` de `/api/v1/live-sync/operations` responden **410 `QUALITY_CIRCUIT_RETIRED`**.
- Las cuentas CALIDAD existentes siguen iniciando sesión (el sector se conserva en auth); su vista es el **Historial de solo lectura** (incluye decisiones históricas de Calidad).
- `/calidad` redirige a `/mi-trabajo`; `/work-items?sector=CALIDAD` se mantiene como modelo de lectura (histórico).
- Las propuestas de plantillas de Calidad se conservan; solo dejaron de notificarse operativamente.
- "Rehacer" (Producción) ya no depende de decisiones de Calidad.

### Pendientes en Calidad (backfill)

Ítems `revision` + `quality_status = pendiente` + `completed_at` + sin entrega activa:

- **No se marcan entregados ni se modifican.** El servicio idempotente `retireQualityCircuitDurable` (`src/lib/planning/circuit/quality-retirement.ts`) registra un evento `QUALITY_CIRCUIT_RETIRED` por ítem (id determinístico + `onConflictDoNothing`) y una notificación resumen.
- Se ejecutan al abrir «Pendientes de definir» (Producción/Dirección). Ahí se muestran con acciones según el sector (`classifyPendingDefinition`): Elaboración → Enviar a Envasado; Envasado → Registrar entrega / Enviar a Codificado; Codificado → Registrar entrega; sector no determinable → «pendiente de asignación». Siempre se puede Rehacer.
- Decisiones históricas ya tomadas (aprobado/rechazado) se conservan intactas.

## 3. Elaboración → Envasado

`sendElaboracionToEnvasadoDurable` (una transacción, `FOR UPDATE`):
- Crea el trabajo de Envasado o **enlaza uno existente** del mismo pedido+producto (sin duplicar). Destino Masivo/Premium deducido por pedido+producto, luego historial cliente+producto; si es ambiguo el diálogo obliga a elegir.
- Deja el origen en `completo` (no es entrega final), el pedido en `EN_ENVASADO` (monótono) y eventos `SENT_TO_ENVASADO` / `RECEIVED_FROM_ELABORACION` (quién, cuándo, producto, cliente, cantidad).
- Idempotente por `idempotencyKey` (`elab2env:<id>` por defecto).

## 4. Entregas y parciales (contabilidad)

- Tabla nueva `work_item_delivery_lines`: una línea inmutable por entrega física, única por `(work_item_id, idempotency_key)`. La fila agregada de `work_item_deliveries` (única activa por trabajo) pasa a tener `delivery_complete` y `pending_balance`.
- Acumulado = suma de líneas ACTIVAS. Objetivo = unidades embaladas > total declarado > realizado > planificado. Un paso no puede superar el saldo ni ser no entero (unidades).
- Parcial: el trabajo NO queda entregado hasta completar; el saldo se conserva y se permiten parciales posteriores. Reintento con la misma clave = misma entrega.
- Trabajo → `entregado` al completar; pedido → `ENTREGADO` (monótono, con evento de estado) cuando todos sus trabajos de despacho están entregados.
- Envasado → Codificado mueve la MISMA fila (no duplica unidades): una fila = una entrega.
- RBAC de `deliver_work` (`canActorDeliverItem`): Producción/Dirección todo; Envasado Masivo/Premium solo lo propio; Codificado lo propio; Elaboración y Calidad nunca.
- Descuento de MP (OE `deliver`, `applyOeConsumption`, PR #125): no se tocó; es independiente de `work_items`. Cubierto por las E2E de regresión.

## 5. Excepción de cajas

- **Solo Envasado → Codificado**: se pide únicamente la cantidad total; sin error por falta de desglose (frontend y backend). No se guarda distribución ficticia ni se tocan registros viejos (`closeForCodificadoTransfer`).
- **Envasado → Entregar**: la validación de cajas se mantiene y ahora se aplica también en el servidor (`assertEnvasadoDeliveryBoxes`: cajas reales + balance, o motivo escrito).

## 6. Notificaciones a Producción

- `circuito_movimiento` en `os_notifications`, sectores `PRODUCCION` y `DIRECCION`, id determinístico (sha256→uuid de tipo+trabajo+clave) con `onConflictDoNothing`.
- Contenido: movimiento, origen, destino, cliente, producto, cantidad, lote, fecha y hora (BA), responsable y enlace al trabajo.
- **Decisión:** se insertan después del commit y en try/catch (mejor esfuerzo): una falla de notificación NUNCA bloquea ni revierte una entrega/traspaso. Un reintento re-emite con el mismo id (idempotente).
- Campana: contador de no leídas, abrir el trabajo, marcar leída, marcar TODAS leídas (`PATCH /api/v1/notifications` `read_all`) e historial.

## 7. Compatibilidad

KPI «Esperando Calidad» y `analytics.ts` reemplazados por indicadores del circuito nuevo (pendientes de definir, entregas parciales con saldo, etc.). OE/OA, Código MP, KG real, descuento de inventario, ingresos MP/ME, fotos de remito, Métricas, calendario de Entregas, Dashboard, Mi trabajo, Codificado, auditoría y permisos no se modificaron salvo lo indicado.

## 8. Riesgos y limitaciones

- Ids no nativos (legado local) conservan el flujo histórico; los ítems nativos se refrescan desde el servidor.
- `mocks/workspace/calidad.mock.ts` y el `premium-workspace-home` obsoleto conservan texto de Calidad (solo mocks/seed).
- Decisiones históricas de Calidad aún bloquean celdas en plan-semanal (mensaje actualizado).
- El calendario de Entregas (otra rama) ya derivaba estados sin Calidad; `rules.test.ts` conserva referencias históricas.
- La E2E `entregas` no puede correr en modo desarrollo en este sandbox (`next/font/google` se cuelga sin red) y en build de producción el override de fecha `SEMANAS_TODAY_OVERRIDE` no aplica, por lo que 3 chequeos dependientes de "hoy" fallan fuera de la fecha fija; no son del circuito.
- Rollback: la migración 0047 es aditiva; no hay que revertir datos. Para volver al circuito anterior basta desplegar el código previo (las tablas nuevas quedan sin uso).

## 9. Pruebas

- Unit/integración: `src/lib/planning/circuit/*.test.ts`, `work-item-progress-repository.test.ts`, `work-item-end-to-end.test.ts`, `codificado-handoff-service.lote-vto.test.ts`, `live-sync/operations/route.test.ts`.
- E2E: `npm run test:e2e:circuito` (62 verificaciones: Elab→Masivo/Premium, Envasado→Codificado sin cajas, Entrega con cajas, Codificado→Entrega, parciales, duplicados, notificaciones, Calidad fuera, historial, pendientes reubicados, permisos, escritorio/tablet/celular). Correr bajo `flock /tmp/e2e.lock` (puertos compartidos). El runner habilita `live-sync` con credenciales Google ficticias (`GENUS_E2E_FAKE_LIVE_SYNC=1`, solo para la base descartable).
- Regresión: `oe-consumo-real` (37/37), `oe-eliminar` (23/23), `oe-automatica` (40/40), `dashboard` (200/200), barrido de secciones.
