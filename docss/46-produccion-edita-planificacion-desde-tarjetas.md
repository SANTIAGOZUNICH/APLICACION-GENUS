# 46 — Producción edita la planificación de todos los sectores desde las tarjetas

Estado al 2026-10-09. Rama `claude/produccion-edicion-planificacion` (parte de `main` con el PR #110 mergeado). **Sin migraciones.**

## 1. Diagnóstico: por qué no se podían editar los datos de las tarjetas

| Lo que se veía | Causa en el código |
|---|---|
| Datos que parecían texto fijo | La tarjeta solo se resaltaba al pasar el mouse (sin lápiz ni otra señal). En tablet no hay hover, así que los datos no parecían editables. |
| Muchos trabajos sin ninguna edición | Si el sector ya había informado el trabajo (`completo`, `revision`, `en_codificado`, `codificado_completo`), **todos** los campos quedaban bloqueados. El motivo aparecía solo en un *tooltip*. |
| Lote, VTO y realizadas siempre fijos | En tarjetas, lote/VTO eran texto (se editaban solo en «Planilla»). Para corregir la cantidad realizada no había función en el servidor. |
| Envasado → «Semana» y Elaboración → «Semana» | El tablero semanal usa sus propias tarjetas (`WorkItemRichCard` / `CompactWorkItem`), que eran de solo lectura y no abrían nada. |
| Codificado | La vista es una tabla propia y todo era estático. El detalle mostraba producto y cliente como texto. |
| Prioridad | Solo se podía editar si el trabajo estaba vinculado a una tarea de Semanas. Si no, la tarjeta mandaba a «Semanas → Lista». |
| Semanas «Solo lectura» | `isSemanasWritable()` devuelve `false` siempre que `VERCEL_ENV=production` (ver §4). |

## 2. Qué campos tenían backend de edición (auditoría) y qué se hizo

| Campo | Backend antes | Ahora (reutilizando la misma función) |
|---|---|---|
| Producto, cliente, cantidad planificada, unidad, fecha de producción, entrega, observación | Sí: `updateWorkItemPlanningDurable` vía `PATCH /api/v1/work-items/cells` (versión + `PLANNING_FIELDS_CORRECTED`) | Editables desde la tarjeta con lápiz, «Guardar»/«Cancelar» y confirmación «Guardado». |
| Responsable / línea | Sí (PR #110): `updateWorkItemAssigneeDurable` | Ahora se elige de una lista: Cristian/Nicolás, o Línea 1–4 (1–2 en Premium). |
| Lote y VTO del trabajo | Sí: `updateWorkItemLoteVtoDurable` (motivo obligatorio, `LOTE_VTO_CORRECTED`) | Editables en la tarjeta para asignar, corregir, reasignar y desasignar (vaciar), siempre con motivo. |
| Cantidad realizada | **No había función** para corregirla. | Nuevo `correctFinishedQtyDurable`: motivo obligatorio, versión y valor visto (si el sector registró otro avance mientras tanto, da conflicto). Deja el evento `FINISHED_QTY_CORRECTED` con valor anterior y nuevo. No es un avance: no cambia el estado ni «último avance por». |
| Prioridad | Sí, para trabajos vinculados (tabla 0041). | Si el trabajo no está vinculado, «Asignar prioridad» lista las tareas de Semanas de su sector y semana; Producción **elige** una. Así se crea el vínculo explícito con la API 0042 y la prioridad se edita en la tarjeta. No se usa la columna vieja `work_items.priority`, para no tener dos fuentes. |
| Trabajos ya informados por el sector | Bloqueados por completo. | Editables **con motivo obligatorio**, que queda auditado. |
| Calidad decidió / entregado / envasado cerrado / cancelado | Bloqueados. | Siguen bloqueados. La tarjeta lo dice y explica cómo corregir: anular la decisión de Calidad, anular la entrega o restaurar el trabajo. |

Dónde se edita: en las tarjetas del día de Elaboración, Envasado Masivo y Envasado Premium; en el botón **«Editar»** de cada tarjeta del tablero semanal (abre el detalle con la planificación editable); y en Codificado, con **«Abrir / Editar»**. El detalle siempre lee el trabajo actualizado del servidor antes de editarlo.

## 3. Asignación de lotes

| Necesidad | Estado |
|---|---|
| Asignar / corregir / reasignar / desasignar el lote de un trabajo | Desde la tarjeta (lote y VTO, con motivo, auditado). |
| Corregir cantidades y vencimiento de un lote del registro | Ya existía (planilla y formulario). **Nuevo:** la edición por formulario queda auditada campo por campo, en la misma transacción. También tiene control de concurrencia: si otro usuario o la sincronización cambió el lote mientras se editaba, el cambio no pisa el del otro. |
| Historial de cambios | **Nuevo** botón «Historial» por lote. Muestra valor anterior → nuevo, usuario, sector, fecha y origen (planilla o formulario), más el alta y el archivo con su motivo. Ruta: `GET /api/v1/asignacion-lotes/[id]/history`. |
| Lote ya aprobado, rechazado, cerrado o entregado | **Nuevo:** no se cambian lote, producto, código ni VTO de ese lote en el registro, porque eso sobrescribiría el historial. El mensaje explica el procedimiento. Las observaciones sí se pueden editar. |
| Filas sincronizadas desde Google Sheets | Siguen en solo lectura: la sincronización las pisaría. El write-back sigue bloqueado en Production (`ASIGNACION_LOTES_WRITEBACK`, lista de permitidos, originales protegidos). |

## 4. Semanas: por qué sigue bloqueado y cómo habilitar la edición de forma segura

Para que GENUS escriba en la planilla tienen que cumplirse **todas** estas condiciones:

1. `VERCEL_ENV !== "production"`
2. La planilla no es la copia incluida en Preview.
3. La planilla no es una original protegida.
4. `SEMANAS_WRITEBACK=1`.
5. El id de la planilla está en `SEMANAS_WRITEBACK_SPREADSHEET_IDS`.
6. La planilla no es la SEMANAS 2026 original indexada.

En Production la primera condición es falsa **a propósito**. No se tocó.

Por qué la escritura directa no es segura hoy:

- Las tareas son celdas de texto libre: varias líneas y varios productos por celda, sin un id estable.
- La planilla la editan personas en paralelo.
- Una escritura en Sheets y en la base a la vez no puede ser atómica.

Propuesta (no implementada como sincronización):

1. **La planificación editable vive en GENUS.** Son los trabajos (`work_items`): versión, auditoría y permisos. Es lo que este PR deja editable desde todas las pantallas. La planilla queda como referencia en vivo.
2. **Origen preservado y diferencias visibles:**
   - Se mantiene el vínculo explícito tarea ↔ trabajo.
   - «Crear trabajo desde esta tarea» crea el trabajo ya vinculado.
   - Se mantiene el aviso «Difiere de Semanas (no se sincroniza solo)».
   - Nunca se presenta un dato como sincronizado si no lo está.
3. **Si más adelante se quiere escribir en la hoja:** primero en una **copia** autorizada, con la ruta ya existente `writeSemanasCell` (reserva de celda, comparación previa y lectura de confirmación). Cada celda se propone y se confirma de forma explícita. Pasarlo a la original requiere autorización expresa.

El aviso de Semanas ahora explica esto: por qué no se escribe, qué sí se guarda en GENUS (prioridad, vínculos, crear trabajo) y dónde editar los datos de cada trabajo.

## 5. Permisos (servidor)

- **Producción:** edita la planificación de todos los sectores. Cada cambio pasa por versión (409 si está vieja), auditoría con usuario, fecha, valor anterior y nuevo, y motivo cuando corresponde.
- **Operarios:** sin cambios. Avance y finalización como antes. Planificación, corrección de realizadas y lotes → **403**.
- **Calidad:** sin cambios en sus permisos (matriz de Asignación de lotes y decisiones).

## 6. Validación

- `npm run test:e2e:produccion-edicion`, en Chromium con Postgres descartable y login real: **27/27**. Capturas en `docss/img/produccion-edicion/`.
  - Producción edita en tarjetas de Envasado: producto, cliente, cantidad, unidad, entrega, observación, lote, VTO y realizadas.
  - Recarga la página y confirma los datos en la base y en la auditoría.
  - Trabajo aprobado: el bloqueo es visible y explica el procedimiento.
  - Línea desde la lista.
  - Tablero semanal → «Editar».
  - Elaboración: responsable y fecha.
  - Codificado: «Abrir / Editar».
  - Lote: corrección e historial.
  - Prioridad de un trabajo sin vínculo.
  - Operario en tablet: sin lápices, conserva «Registrar avance», y el servidor responde 403.
- `npm run test:e2e:produccion-edicion-db`, contra Postgres real: **16/16**. Incluye:
  - corrección de realizadas (motivo, conflicto, auditoría);
  - lote/VTO: asignar, corregir, desasignar, versión vieja;
  - trabajos informados con motivo;
  - bloqueo por decisión de Calidad;
  - avances y finalizaciones del sector **después** de las ediciones;
  - lotes: formulario auditado, concurrencia, historial, lote aprobado protegido, operario sin permiso.
- Regresión:
  - E2E de Mi trabajo y Semanas: 50/50.
  - E2E de sectores y Modo TV: 37/37.
  - Vitest: 2107 OK.
  - Build OK.

## 7. Limitaciones

- Las rutas HTTP de avance y finalización (`/api/v1/live-sync/operations`) exigen modo real con Google. Sus funciones durables se validaron contra Postgres real.
- La auditoría de Asignación de lotes no tiene columna de motivo (tabla 0040). El archivo sí guarda su motivo.
- El tablero semanal muestra hasta 5 o 6 trabajos por día («+N más»). El resto se edita desde la vista Día.
- En el «Panel general» de Producción, «Asignado a» y Estado siguen sin edición en la tabla. Se editan desde el sector.
