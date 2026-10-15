# Calendario de Entregas — auditoría de fechas y correcciones de Producción

## 1. Auditoría de fechas (solo lectura)

### Cómo arma el calendario cada fecha

| Aparición en el calendario | Fecha que usa | Tipo de dato |
|---|---|---|
| Entrega programada (manual, creada por Producción) | `scheduled_deliveries.delivery_date` | `DATE`, sin hora ni zona: no se desplaza |
| «Desde trabajo» (derivada) | `work_items.delivery_date` | `DATE` |
| Entrega real (Entregados) | `work_item_delivery_lines.actual_delivered_at` (cada envío) | `TIMESTAMPTZ`, convertida a día **de Argentina** (`America/Argentina/Buenos_Aires`) |

Prioridad: si un trabajo está vinculado a una entrega programada, manda la fecha **manual** (la de la entrega programada);
la fecha del trabajo no se usa para ubicarlo. Ninguna sincronización reescribe `work_items.delivery_date` ni las fechas
de las entregas programadas: las correcciones de Producción no se pisan.

### Causas encontradas (demostradas en el código)

1. **Entregas parciales en un solo día (corregido).** La fila resumen `work_item_deliveries` guarda solo la fecha del
   **último** envío y la cantidad acumulada. El calendario leía esa fila: todos los envíos parciales aparecían juntos en
   la fecha del último. Ahora cada línea ACTIVA de `work_item_delivery_lines` aparece en su propia fecha (en hora
   argentina) con su cantidad. Las filas resumen sin líneas (datos anteriores a 0047) se siguen mostrando como antes.
2. **Entregas guardadas a las 00:00 UTC (marcado, no corregido).** Un registro a medianoche UTC corresponde a las 21:00
   del día **anterior** en Argentina. Es probable que se haya cargado solo la fecha y no la hora, pero no hay forma de
   saberlo con certeza: no se corrige; se marca «Revisar fecha» para que Producción decida.
3. **Fecha de entrega anterior a la fecha de producción (marcado).** Dato contradictorio: se marca para revisión.
4. **Trabajo vinculado con otra fecha (marcado).** El trabajo dice una fecha y la entrega programada otra; se muestra en
   la fecha manual y se marca.
5. **Estado «entregado» sin entrega real registrada** (informado en la auditoría): no aparece como entrega real porque no
   hay fecha real que mostrar.

Inconsistencia anotada, fuera de este cambio: la vista Entregados recorta `actualDeliveredAt` a la fecha UTC.

### Cómo consultarla

`GET /api/v1/entregas/audit` (solo Producción) y el panel «Auditoría de fechas» del calendario. Devuelve, por categoría,
la cantidad y hasta 50 ejemplos (cliente, producto, detalle). **No escribe nada.**

**Bloqueo:** desde el entorno de desarrollo no hay credenciales de la base de producción, así que la auditoría con los
datos reales la tiene que ejecutar Producción desde la app (panel o endpoint). No se modificó ningún dato histórico ni se
inventaron fechas.

## 2. Correcciones de Producción (todas con motivo y auditadas)

- **Trabajo «Desde trabajo»:** editar fecha de entrega, cantidad y observaciones (por celda, con la misma auditoría que
  Producción usa en el resto de la app). Si el trabajo está vinculado a una entrega programada, su fecha se cambia
  reprogramando esa entrega. Historial: `entity_id = work:<id>`.
- **Quitar del calendario (lógico):** `delivery_calendar_hidden` (migración 0050). El trabajo no se toca; la aparición
  no vuelve a mostrarse aunque el trabajo siga con fecha, hasta que se restaure. Se ven con «Mostrar quitadas».
  Las **entregas reales nunca se ocultan ni se borran** desde el calendario: se corrigen solo con la anulación auditada de
  Entregados.
- **Entrega programada:** reprogramar, cancelar y **restaurar** (antes no había restauración).
- **Producto de una entrega programada:**
  - *Mover a otra fecha:* sale de esta entrega y pasa a la entrega programada del mismo cliente en la nueva fecha (o a
    una nueva). **Los demás productos del cliente no se mueven.** Si es el único producto, se reprograma la entrega.
  - *Quitar* (baja lógica con motivo, `deleted_reason`) y *restaurar*. No se puede quitar el único producto ni uno con
    trabajos vinculados (primero se desvinculan).

Nada de esto toca stock, movimientos, lotes, consumos de MP ni entregas reales.

## 3. Migración 0050 (aditiva, reconcile-safe)

- Tabla `delivery_calendar_hidden` con índice único parcial (un ocultamiento activo por trabajo).
- Columna `scheduled_delivery_items.deleted_reason`.

## 4. Pruebas

- Unitarias: `src/lib/entregas/*.test.ts`.
- Integración Postgres: `src/integration/entregas-calendario.db.integration.test.ts` (parciales en su fecha, medianoche
  UTC, contradicciones, edición/ocultar/restaurar, entregas reales no ocultables, mover/quitar/restaurar producto,
  cancelar/restaurar, permisos, huella de inventario intacta).
- E2E navegador: `scripts/e2e/entregas-correcciones-validate.mjs`.
