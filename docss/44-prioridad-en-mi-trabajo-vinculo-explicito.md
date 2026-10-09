# 44 — Prioridad de Semanas en «Mi trabajo»: vínculo explícito tarea ↔ trabajo operativo

Estado al 2026-10-09. Continúa `docss/43` (PR #110). Migración nueva **0042, aditiva** (solo `CREATE TABLE/INDEX IF NOT EXISTS`).

## 1. Qué identificadores existen (análisis)

| Dato | SEMANAS 2026 (tareas de la planilla) | `work_items` («Mi trabajo») |
|---|---|---|
| OE / OA | **no** (0 de 1.454 líneas de tareas, Elaboración + Acondicionamiento) | `order_number`, `order_id` |
| Pedido | **no** | `production_pedido_id` |
| Lote / VTO | **no** | `packaging_lote`, `packaging_vto` |
| Celda / fila de origen | sí (A1, solo dentro de la planilla) | **no** (`origin_ref` = clave de idempotencia de la asignación, `source` = `native`) |
| Cliente, producto, cantidad, fecha | texto libre en celdas | campos propios, cargados a mano por Producción |
| Responsable / línea | banda combinada (CRISTIAN, NICOLAS; Masivo/Premium) | `branch_owner` (Cristian/Nicolás), `line` (Línea 1–4) |
| Prioridad | tabla 0041 (URGENTE / IMPORTANTE / NORMAL) | columna heredada `priority` (URGENTE/HOY/ESTA_SEMANA/NORMAL/BAJA), siempre NORMAL, no se muestra |

**Conclusión:** no hay un identificador común. Los únicos datos compartidos son cliente/producto/cantidad/fecha, escritos a mano
en dos lugares (con abreviaturas, typos y cantidades dentro del texto). Vincular por esas coincidencias podría mostrar una prioridad
equivocada, así que **no se vincula automáticamente**. La columna heredada `work_items.priority` **no se usa ni se modifica**
(mezclaría dos sistemas de prioridad).

## 2. Mecanismo: vínculo explícito confirmado por Producción

- Tabla `semanas_task_links` (0042): `task_key`/`pos_key` de la tarea + `work_item_id` + versión + quién/cuándo. **Un trabajo tiene a lo
  sumo un vínculo activo** (índice único parcial). Una tarea puede tener varios trabajos (p. ej. una elaboración con dos productos).
- Desvincular es lógico (`unlinked_at`); nada se borra. Auditoría en `semanas_task_link_events` (LINK / UNLINK, motivo, actor,
  resumen de la tarea y del trabajo en ese momento).
- Validaciones en el servidor: solo Producción; la tarea tiene que existir ahora en la planilla; el trabajo tiene que existir, no
  estar borrado, ser del **mismo sector** (o haber pasado a Codificado desde ese sector) y de la **misma semana**.
- Corregir un vínculo equivocado («Mover aquí») o quitarlo exige **versión** (concurrencia) y **motivo** (mín. 8 caracteres).
- Sugerencias: trabajos libres de la misma semana y sector, ordenados por coincidencias (mismo día / cliente / producto) que se
  **muestran** a Producción. Nunca deciden nada.
- El vínculo sigue a la tarea con las mismas reglas que la prioridad (texto corregido o traslado de día inequívoco). Si la tarea
  desaparece de la planilla, el trabajo **deja de mostrar prioridad** y Producción ve un aviso «vínculos sin tarea» para corregirlo:
  nunca se pasa a otra tarea.

## 3. Pantallas

- **Producción → Semanas (Lista):** columna «Trabajo vinculado» y panel **en línea** (sin ventanas flotantes) con los trabajos
  vinculados (Quitar con motivo), sugerencias de la semana (Vincular) y «Ya vinculados a otra tarea» (Mover aquí con motivo).
  El historial de la fila muestra prioridad + vínculos.
- **Sectores → Mi trabajo:** prioridad de solo lectura con **indicador de color + borde lateral** (rojo / amarillo / verde):
  columna «Prioridad» y borde en la planilla del día (`rowClassName`, prop opcional y aditiva de `GenusGrid`), etiqueta y borde
  en la lista, etiqueta sólida (legible sobre fondo claro u oscuro) y borde en el tablero semanal, etiqueta en el detalle.
  Un trabajo **sin vínculo** muestra la indicación neutral «Sin prioridad» (gris, sin borde): nunca se inventa una prioridad.
  Los botones «Ver / Registrar avance», «Guardar avance», «Finalizar y enviar a Calidad», Codificado, etc. no cambiaron.
- La prioridad que ve «Mi trabajo» sale de la misma proyección que Semanas, Día a día y Modo TV (`plan-tasks.ts`).

## 4. Permisos (servidor)

| Endpoint | Producción | Dirección | Sectores |
|---|---|---|---|
| `POST/DELETE /api/v1/semanas/links` | ✅ | 403 | 403 |
| `GET /api/v1/semanas/links/candidates` | ✅ | 403 | 403 |
| `GET /api/v1/semanas/work-item-priorities` | todos los trabajos | todos | **solo trabajos de su sector** |
| `GET /api/v1/semanas/priorities` (historial prioridad + vínculos) | ✅ | ✅ | 403 |

Si la planilla no se puede leer, `work-item-priorities` responde `available:false` sin prioridades (nunca una prioridad dudosa).

## 5. Validación

- `src/integration/semanas-links.db.integration.test.ts` (Postgres **real** descartable, 6 casos): productos repetidos y tareas
  idénticas (solo el trabajo vinculado recibe prioridad; el idéntico sin vínculo queda neutral), borrar una de dos tareas
  idénticas no transfiere la prioridad, persistencia entre instancias, concurrencia (índice único: un solo vínculo gana),
  permisos, y **avance + finalización reales** (`saveWorkProgressDurable` / `completeWorkDurable`, las mismas funciones que
  `/api/v1/live-sync/operations`) sobre un trabajo vinculado, con el RBAC operativo intacto. Se corren en serie con el test de
  prioridades (comparten la base y ese test renombra la tabla temporalmente).

- Unit/servidor: `semanas-links.test.ts` (11), `semanas/links/route.test.ts` (3). Suite completa: 2102 OK.
- `npm run test:e2e:semanas-mi-trabajo` — **30/30 en Chromium** (tres prioridades + neutral + producto repetido, bordes en
  planilla / lista / tablero semanal) con Postgres **descartable** (migraciones reales 0000–0042, login
  real, planificación nativa, copia local del libro; nunca Google ni Neon). Capturas en `docss/img/semanas-mi-trabajo/`.
- `npm run test:e2e:semanas-priorities-db` — 10/10 contra Postgres real (prioridades 4 + vínculos 6), 3 corridas seguidas.

## 6. Limitaciones

- Los vínculos se crean a mano: los trabajos ya existentes aparecen **sin prioridad** hasta que Producción los vincule.
- Solo trabajos de la planificación nativa (base de datos). En la copia de Preview sin base, la columna no se muestra.
- La vista planilla de «Mi trabajo» (`GenusGrid`) solo admite texto por celda: la prioridad se ve como «🔴 URGENTE» + borde
  lateral; la etiqueta de color completa está en la vista lista, el tablero semanal y el detalle.
- Avances y finalizaciones se validaron con sus funciones durables contra Postgres real; la ruta HTTP
  `/api/v1/live-sync/operations` exige modo real con Google y no se puede ejecutar en un entorno local.
- Preexistente (no cambiado): la columna «HOY» del tablero semanal de «Mi trabajo» tiene fondo claro con texto claro.
- Quitar un vínculo «sin tarea» desde el aviso superior usa un cuadro del navegador para el motivo (caso poco frecuente).
