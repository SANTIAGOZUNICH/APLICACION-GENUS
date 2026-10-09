# 43 — Semanas: prioridades compartidas, vistas por sector, Lista de Producción y Modo TV sectorial

Estado al 2026-10-09. Parte de `main` posterior al PR #109 (calendario, prioridades 0041, Modo TV). **Sin migraciones nuevas.**

## 1. Cómo se relacionan las tareas (diagnóstico)

| Concepto | Origen | Identidad |
|---|---|---|
| **Tarea de Semanas** (`CalendarTask`) | Lectura en vivo de SEMANAS 2026 (`ELABORACION`, `ACONDICIONAMIENTO`) | `key` = pestaña · fecha · texto normalizado · n-ésima repetición |
| **Prioridad** | Tabla `semanas_task_priorities` (0041) + auditoría `semanas_task_priority_events` | se asocia a la `key` de la tarea |
| **Trabajo operativo** (`work_items`) | Base (`/api/v1/work-items`, `live-sync`) — lo que cada sector usa en «Mi trabajo» | id propio; **no tiene vínculo con la tarea de Semanas** |

No hay un identificador común entre una tarea de la planilla y un `work_item`. Por eso **no se asume que sean la misma entidad**:
la prioridad (compartida) vive sobre las tareas de Semanas y se ve en todas las pantallas que muestran esas tareas
(Producción → Semanas, Semanas / Día a día de cada sector y Modo TV). El trabajo operativo de los sectores sigue intacto en «Mi trabajo».

## 2. Prioridades compartidas (misma tabla, misma lógica)

- Una sola fuente: `semanas_task_priorities`. No se creó una segunda tabla ni prioridades por sector.
- Una sola proyección: `src/lib/semanas-sheet/plan-tasks.ts` (pura) arma producto, cliente, cantidad, notas, fecha, responsable/línea,
  sector y prioridad para **todas** las pantallas. Producción la usa con celdas (para editar); los sectores, sin celdas.
- Asociación prioridad ↔ tarea (`matchPriorityRows` en `priorities.ts`), de más a menos segura:
  1. **exacta** (misma clave): sobrevive a insertar/borrar filas, reordenar, renombrar el responsable y a cada sincronización.
  2. **texto corregido**: misma posición y ≥1 línea en común con ≤1 línea distinta. *Nuevo:* si se **elimina** una tarea y otra ocupa
     su lugar, o se **reemplaza** todo el texto, la prioridad **no** se transfiere (antes bastaba la posición).
  3. **traslado de día** (*nuevo*): contenido idéntico, misma semana, y era único en la semana cuando se fijó la prioridad
     (marca `|solo` en `pos_key`, sin migración). Si había otra tarea idéntica esa semana, el traslado es ambiguo y no se infiere.
     Mover a otra semana no arrastra la prioridad.
- Al re-asociar, los eventos de auditoría pasan a apuntar a la clave nueva (la historia sigue a la tarea; el contenido de cada
  evento no cambia). Nada se borra: la sincronización nunca elimina prioridades.
- Concurrencia: igual que antes (versión + CAS en la transacción; 409 si otro usuario la cambió).
- Nunca se infiere prioridad por colores de la planilla.

## 3. Permisos (verificados en el servidor)

| Acción | Producción | Dirección | Elaboración | Env. Masivo | Env. Premium | Codificado / Depósito | Materia Prima | Calidad / Comercial |
|---|---|---|---|---|---|---|---|---|
| `GET /semanas/grid` (planilla completa) | ✅ | — | 403 | 403 | 403 | 403 | 403 | 403 |
| `PATCH /semanas/cells` (editar planificación) | ✅ (copias autorizadas) | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| `PATCH /semanas/priorities` | ✅ | 403 | 403 | 403 | 403 | 403 | 403 | 403 |
| `GET /semanas/priorities` (historial) | ✅ | ✅ | 403 | 403 | 403 | 403 | 403 | 403 |
| `GET /semanas/plan` (**nuevo**, solo lectura) | todos los sectores | todos | Elaboración | Masivo | Premium | Masivo + Premium | Elaboración | 403 |

- La identidad sale de la sesión (`resolveOrdersActor`); `?sector=` se valida contra lo permitido (403 si pide otro).
- El alcance de Codificado / Depósito / Materia Prima es el mismo que ya rige el plan semanal compartido (`weekly-plans-rbac.ts`).
- A los sectores no se les envían celdas (A1), protecciones ni el resto de la planilla.
- Las acciones operativas (avances, cantidades realizadas, observaciones, finalizar) no cambiaron: siguen en «Mi trabajo» con su RBAC.

## 4. Pantallas

- **Producción → Semanas:** una sola vista, **Lista** (una fila por tarea: prioridad, fecha, responsable/sector, cliente, producto,
  cantidad, notas). Clic en un campo → se edita en el lugar; Enter guarda, Esc cancela, Tab/flechas navegan, Ctrl+C / Ctrl+V,
  Supr vacía; en Prioridad, menú mínimo o teclas 1/2/3. Botón de historial por fila (auditoría + celdas de la planilla).
  Se retiraron de la interfaz «Calendario», «Planilla» y «Ver como lista». El motor (`useCalendarEngine`) y sus reglas
  (validación, motivo en fechas pasadas, celdas protegidas, conflicto, idempotencia, bitácora) son los mismos.
  C/DIA y Entregas siguen como tabla editable (ya eran listas).
- **Sectores → Semanas** (nuevo ítem del menú): «Semanas» (semana por días) y «Día a día» (hoy o el próximo día con tareas,
  agrupado por prioridad). Solo lectura, actualización automática cada 60 s, indicador de última actualización.
- **Modo TV** (Producción y sectores): pantalla completa sin sidebar, solo lectura, rotación entre sectores solo si el usuario
  ve más de uno; 3 columnas en 1280/1366 y 4 en 1920 (ancho constante: si hay menos días, un día usa varias columnas de tarjetas);
  etiquetas PRODUCTO / CANTIDAD / CLIENTE / RESPONSABLE o LÍNEA / FECHA; aviso claro si se corta la conexión (conserva lo último).

## 5. Validación

- `npm run test` — 2088 tests OK (nuevos: `plan-tasks.test.ts`, `sector-plan.test.ts`, `semanas/plan/route.test.ts`, casos de
  eliminar / reemplazar / mover en `semanas-priorities.test.ts`).
- `npm run test:e2e:semanas-sectores` — 37/37 comprobaciones en Chromium real contra la copia local (nunca Google, nunca Neon).
- Capturas: `docss/img/semanas-sectores/`.

## 6. Limitaciones conocidas

- **Fecha y responsable no se reasignan desde la Lista**: cambiarlos implica mover celdas entre columnas/bandas combinadas de la
  planilla (varias escrituras no atómicas en Google). Se muestran con su origen; se cambian en la planilla.
- **Línea de envasado:** la planilla actual no tiene bandas de LÍNEA (solo «ENVASADO CONSUMO MASIVO» / «… PREMIUN»), así que no
  se muestra ninguna línea. Si se agregan bandas «LÍNEA n» / «PREMIUM A», se muestran como LÍNEA automáticamente.
- **Cantidad:** se muestra solo cuando la planilla la tiene en su propio renglón; cuando viene dentro del texto del producto
  («CREMA CHICLE 95kg») no se separa (sería interpretar).
- **«Mi trabajo» (`work_items`) no muestra la prioridad de Semanas**: no hay identidad común inequívoca entre ambos registros.
- Codificado y Depósito no tienen bandas propias en SEMANAS 2026: ven Envasado (Masivo + Premium), como en el plan compartido.
- Los componentes `semanas-cards-view.tsx` y `semanas-calendar-grid.tsx` quedan sin ruta (sus tests cubren el motor compartido).
- La prueba de prioridades contra Neon (`test:e2e:semanas-priorities-db`) requiere una base descartable; no se ejecutó en este entorno.
