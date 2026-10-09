# 45 — Producción edita «Mi trabajo» de cada sector · origen de cada dato · vínculo al crear

Estado al 2026-10-09. Continúa `docss/43` y `docss/44` (PR #110). **Sin migraciones nuevas** (usa 0041 y 0042).

## 1. De dónde sale cada dato (análisis)

| Dato que se ve en «Mi trabajo» | Fuente única | Quién lo edita | ¿Se copia a otro lado? |
|---|---|---|---|
| Producto, cliente, cantidad, unidad, fecha planificada, entrega, observaciones, lote/VTO | `work_items` (Postgres, planificación nativa) | Producción (PATCH `/api/v1/work-items/cells`) | No. Se ve igual en todas las vistas que leen `work_items` (Mi trabajo de cada sector, tablero semanal, detalle). |
| Responsable (Elaboración: Cristian/Nicolás) · Línea (Envasado: Línea N) | `work_items.branch_owner` / `work_items.line` | Producción (campo nuevo `assignee` del mismo PATCH) | No. |
| Prioridad URGENTE / IMPORTANTE / NORMAL | `semanas_task_priorities` (0041), por **tarea de Semanas** | Producción (desde Semanas o desde la tarjeta de un trabajo **vinculado**) | No: es la misma fila; Mi trabajo la lee a través del vínculo (0042). |
| Realizadas, avance, observación operativa, finalización | `work_items` (funciones durables de avance/finalización) | El sector (igual que antes) | No. |
| Tarea de Semanas (texto, día, banda, responsable) | Hoja **SEMANAS 2026** (lectura en vivo) | Solo en la planilla | — |

Conclusión: editar un trabajo **no** cambia Google Sheets y no se intenta. La escritura a la planilla sigue bloqueada (no se habilitó),
las celdas de una tarea son texto libre ambiguo (varias líneas, varios productos por celda) y una escritura a la Hoja + Postgres no puede
ser atómica. En lugar de sincronizar a ciegas, la tarjeta de Producción muestra **«Difiere de Semanas (no se sincroniza solo)»** cuando la
fecha del trabajo cae fuera de la tarea vinculada o la cantidad no aparece en el texto de la tarea. El producto no se compara (los nombres
de la planilla son libres y daría falsos positivos).

## 2. Qué puede editar cada uno (servidor)

- **Producción**: campos de planificación de la tabla anterior, más prioridad de trabajos vinculados. Cada cambio:
  - exige `expectedVersion` (CAS sobre `work_items.version`; versión vieja → **409**, nunca pisa un cambio ajeno);
  - queda auditado en `operational_events` (`PLANNING_FIELDS_CORRECTED`, con antes/después; lote/VTO y trabajos de fecha pasada piden motivo);
  - el responsable se valida por sector (Elaboración solo Cristian/Nicolás; Envasado solo líneas existentes; Codificado no tiene).
- **Sectores**: sin cambios. Registran avance y finalizan igual que antes; intentar editar planificación o responsable → **403**.

## 3. Vínculo al crear un trabajo desde Semanas

En el panel de una tarea, Producción tiene **«Crear trabajo desde esta tarea (queda vinculado)»**. Abre la asignación habitual prellenada
(sector, fecha, cliente, primer producto, cantidad, responsable de la banda, notas) y, al confirmar, el servidor crea el trabajo y registra el
vínculo explícito **con esa tarea** (procedencia: la eligió Producción, nada se infiere por parecido). Si el vínculo no se puede crear (la
tarea cambió, otra semana, sin permiso) el trabajo queda creado, se informa el error en el diálogo y se puede vincular a mano. Los trabajos
creados por otras vías siguen sin prioridad (indicación neutral) hasta que Producción los vincule.

## 4. Pantallas

- **Mi trabajo — tarjetas** (vista por defecto; se puede pasar a «Planilla», preferencia guardada por navegador): prioridad muy visible y
  borde lateral rojo / amarillo / verde; producto y cantidad destacados (planificada, realizadas, diferencia); fecha, responsable/línea,
  cliente, entrega, lote/VTO, notas y avance. Fondo azul marino sin colores saturados. Para Producción cada dato de planificación es editable
  en el lugar (Enter guarda, Esc cancela) y la prioridad se cambia desde la propia tarjeta.
- **Planilla**: la columna «Línea/Responsable» ahora es editable para Producción.
- **Semanas → Lista**: agrupada por **día** (encabezado con fecha larga, HOY y conteo por prioridad) y, en Acondicionamiento, por sector.
  «Ordenar por prioridad» ordena dentro de cada día.

Capturas en `docss/img/semanas-mi-trabajo/`: `10a` (tarjetas Elaboración), `13` (Lista por día), `14` (Producción en Mi trabajo de
Elaboración: edición + diferencia con Semanas), `15` (crear desde Semanas), `16` (Envasado Masivo, tarjeta URGENTE).

## 5. Validación

- `npm run test:e2e:semanas-mi-trabajo` (Postgres descartable, copia local del libro, login real): **50/50**. Incluye Producción editando
  prioridad, cantidad (nueva versión + diferencia), responsable (evento de auditoría), 409 por versión vieja, 403 del sector,
  crear-desde-tarea con vínculo verificado en la base (Elaboración y Envasado Masivo).
- `scripts/e2e/run-semanas-priorities-db-local.sh`: **11/11** (nuevo caso: responsable con CAS, concurrencia, validación y auditoría;
  avances y finalizaciones sobre trabajos vinculados).
- `scripts/e2e/run-semanas-sectores-local.sh`: **37/37** (sin regresiones en Semanas / Día a día / Modo TV).
- Vitest completo, lint de los archivos tocados y `npm run build` en verde.

## 6. Limitaciones

- Nada se escribe en Google Sheets: si Producción cambia fecha, cantidad o responsable de un trabajo, la planilla no se actualiza (se avisa la
  diferencia). El producto no se compara.
- La ruta HTTP `/api/v1/live-sync/operations` exige modo real con Google; en local se validó con las funciones durables sobre Postgres.
- La columna HOY del tablero semanal nativo conserva su contraste previo (fuera de alcance).
