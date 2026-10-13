# 55 — OE automática con fórmula y lote de fabricación

Rama `claude/oe-automatica-formula-lotes`, que parte de `main` en ada8e8b (incluye #116 a #119).

- **Sin migraciones.** Los datos nuevos van en el `form_data` (jsonb) de la OE, en el campo `autoPrep`.
- **No crea una segunda OE.** Completa la OE que «Asignar trabajo» ya creaba o vinculaba, con el mismo número `OE-YYYY-######`.
- **No escribe en Drive ni en el banco de fórmulas. No usa el Control semanal.**
- **Los lotes de MP NO se asignan automáticamente**: los completa Elaboración en la tabla de la OE, a medida que elabora.
- **No mueve stock.**

## 1. Cómo funcionaba antes (investigado en el código)

| Tema | Antes |
|---|---|
| **Asignación** | `POST /api/v1/work-assignments` → `assignWorkItemDurable`. Con N° de OE, en la **misma transacción** llama a `ensureOeForAssignment`, que busca la OE por Pedido + Producto + Lote o por número; si no existe, la crea. Queda vinculada en los dos sentidos (`operational_orders.linked_work_item_id` ↔ `work_items.order_id`). Es idempotente por `idempotencyKey`, con índices únicos de número e identidad. |
| **OE creada** | **Vacía**: estado BORRADOR, sin materias primas, sin %, columnas de fórmula en null y lote vacío. Para Elaboración el diálogo mandaba el lote en null y no había campo para escribirlo. |
| **Drive** | Cuenta de servicio de **solo lectura**. Carpeta de fórmulas → una subcarpeta por cliente → una planilla por producto. El índice (`drive-formulas-index.ts`, 10 min de caché) se queda con la planilla más nueva de cada producto. `resolveFormulaFromDriveFile` lee MP, código, % y procedimiento, y devuelve ids sintéticos (`drive:<archivo>`) y un hash sha256. |
| **Banco de fórmulas (Neon)** | `formula_products` / `formula_versions` (VIGENTE) / `formula_ingredients`. `resolveLookup` busca cliente + producto normalizados exactos o un alias único, y nunca por parecido. |
| **Producto ↔ fórmula** | El trabajo no tiene código de producto: el vínculo es **cliente + producto** (texto). La OE solo cargaba la fórmula si alguien la buscaba a mano en el editor. |
| **Cantidades** | `recomputeOeDerived`: kg a pesar = cantidad × % / 100, redondeado a 4 decimales. |
| **Lotes** | `asignacion_lotes` solo tiene el lote de **producto terminado** (Envasado). **No existía una asignación estructurada de lotes de MP a una producción.** Lo más cercano es el **Control semanal de MP** (`mp_weekly_controls` + líneas con `lote`), que arma Materias Primas por cliente + producto + kg, y tiene un campo `linked_oe_id` que la pantalla no completa. |
| **Cambios del trabajo** | Solo un cambio de **producto** con Pedido re-resolvía la OE. Cantidad, cliente y lote no se sincronizaban. |
| **Stock** | El consumo de MP ocurre **una sola vez**, al entregar la OE (`applyOeConsumption`, solo en estado COMPLETA). Crear o preparar una OE nunca mueve stock. |
| **Defecto latente** | `formula_product_id` y `formula_version_id` son uuid: si alguien guardaba una fórmula de Drive desde el editor, el id `drive:…` hacía fallar el guardado. |

## 2. Qué hace ahora

### Flujo
1. **Producción asigna el trabajo** con producto, cantidad, elaborador y **lote de fabricación** (campo nuevo en el diálogo de Elaboración, opcional).
2. La transacción de siempre **crea o vincula la OE**, con el mismo número y sin duplicados.
3. Después del commit, `prepareOeFromWork` (`lib/planning/oe-auto-prep.ts`) **carga la fórmula** (`lib/formulas/resolve-for-work.ts`):
   1. primero el banco: coincidencia exacta o alias único;
   2. si no está en el banco, Drive: **una única** planilla cuyo producto coincide exacto en la carpeta del cliente.

   Nunca por parecido. Si es **ambigua, está en conflicto, incompleta** (falta algún %, o el total no da 100 % ± 2) **o no se puede leer**, no se usa y la OE queda pendiente con el motivo.
4. Completa **materias primas, códigos, % y kg a pesar** (cantidad × % / 100, 4 decimales) y el procedimiento.
5. **Copia el lote de fabricación** del trabajo, exacto. También copia producto, cliente y cantidad en kg (solo si la unidad es kg; nunca se convierte).
6. **Deja vacíos los lotes de MP.** El elaborador los completa en la tabla de la OE.

`autoPrep` (en `form_data`) registra la fórmula, su origen (Banco o Drive), versión o hash, archivo, hoja y fecha, quién y cuándo, y los pendientes de Producción y fórmula. Producción ve el resultado en el mismo diálogo, por ejemplo «OE lista con fórmula, cantidades y lote de fabricación».

Si la preparación falla, la asignación igual queda guardada y la OE se puede completar después con la acción explícita.

### Lotes de MP (los carga Elaboración)
- Llegan **vacíos**, con el texto «Completar lote». **Nunca** se toman del Control semanal ni se eligen por stock.
- **Edición tipo Excel** en la columna «Lote N.º» de la tabla de materiales:
  - escribir y **Enter** (o ↓) baja a la fila siguiente;
  - **Shift+Enter** (o ↑) sube;
  - **pegar varias líneas** copiadas de una planilla completa las filas siguientes;
  - se guarda con el autoguardado de la OE.
- El panel muestra «Lotes de MP: N de M cargados».
- **Nunca se pisan**: al recargar la fórmula, cada lote sigue a su materia prima, por código y por fase si la MP aparece dos veces, aunque cambie el orden o se agreguen MP.
- **Si la fórmula nueva ya no tiene una MP con lote o ajuste del elaborador**:
  - la actualización automática **no se aplica**: la OE queda igual y se audita `OE_AUTOPREP_NEEDS_CONFIRMATION` con lo que se perdería;
  - la acción explícita lo **advierte** (MP y lote) y «Aplicar» queda bloqueado hasta marcar «Entiendo que se quitan de la OE»;
  - lo quitado queda en la auditoría y en el historial de versiones.

### Pendientes (nunca se inventa nada)
- **Sin fórmula, ambigua o ilegible**: la OE se crea igual, sin materias primas, con el motivo.
- **Sin lote de fabricación**: queda pendiente.
- **Cantidad en unidades**: kg pendiente.

### Cambios del trabajo
- **Antes de empezar la elaboración** (OE en BORRADOR o PENDIENTE y sin registros del proceso: ajustes, control de proceso, calidad u observación), una corrección del trabajo **re-sincroniza la OE**. Aplica a producto, cliente, cantidad y lote de fabricación.
  - Se recalculan los kg.
  - Se conservan los lotes de MP del elaborador.
- **Después de empezar**: **no se reemplaza nada** (fórmula, cantidades ni lotes). Queda auditado `OE_AUTOPREP_SKIPPED_STARTED`.
- **«Actualizar desde fórmula»** es la acción explícita para Producción o Elaboración:
  - muestra **qué cambiaría** (vista previa, sin guardar) y qué se perdería;
  - aplica al confirmar, con control de versión (409 si la OE cambió mientras se revisaba);
  - conserva lotes, ajustes y datos del proceso.
  - Calidad y Materias Primas no pueden usarla (403).

### Seguridad
- **Drive y banco**: solo lectura. **El Control semanal no se usa.**
- **Stock**: ningún movimiento al crear o preparar la OE. El consumo sigue siendo una sola vez, al entregar.
- **Concurrencia**: fila de la OE bloqueada (`FOR UPDATE`) y versión +1; comparación canónica del jsonb, así que **un reintento no cambia nada ni duplica la auditoría**.
- **Auditoría**:
  - `order_versions` guarda el snapshot completo (eventos `autoprep` / `autoprep_manual`);
  - `order_audit_events` registra `OE_AUTOPREP_APPLIED`, `OE_AUTOPREP_SKIPPED_STARTED`, `OE_AUTOPREP_NEEDS_CONFIRMATION` y `OE_AUTOPREP_MANUAL_REFRESH`, con la referencia de la fórmula (no su contenido), los **lotes de MP antes y después**, lo quitado con confirmación y los pendientes.
- `autoPrep` lo escribe **solo el servidor**: un guardado desde la pantalla no lo cambia.
- **Corrección de un defecto latente**: los ids de Drive (`drive:…`) ya no se guardan en las columnas uuid `formula_*`, donde hacían fallar el guardado.
- **Permisos sin cambios**.

## 3. Validación

Todo en Postgres **descartable**: no se tocaron datos de Production.

| Prueba | Resultado |
|---|---|
| Unitarias (`oe-auto-prep-rules.test.ts`, `work-formula-rules.test.ts`) | 21 + 5 |
| Integración Postgres (`oe-auto-prep.db.integration.test.ts`, dentro de `npm run test:e2e:produccion-edicion-db`) | **15/15** (suite completa 68/68) |
| E2E `GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:oe-automatica` (Chromium, build de producción, usuarios reales) | ver PR |

Capturas en `docss/img/oe-automatica/`.
