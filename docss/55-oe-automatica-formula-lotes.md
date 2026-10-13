# 55 — OE automática con fórmula y lotes

Rama `claude/oe-automatica-formula-lotes`, que parte de `main` en ada8e8b (incluye #116 a #119).

- **Sin migraciones.** Los datos nuevos van en el `form_data` (jsonb) de la OE, en el campo `autoPrep`.
- **No crea una segunda OE.** Completa la OE que «Asignar trabajo» ya creaba o vinculaba, con el mismo número `OE-YYYY-######`.
- **No escribe en Drive, en el banco de fórmulas ni en el Control semanal.**
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

### Asignación (Producción)
1. El diálogo de Elaboración pide el **Lote de fabricación**, que es opcional y se copia tal cual.
2. La transacción de siempre crea o vincula la OE, sin cambios.
3. Después del commit, `prepareOeFromWork` (`lib/planning/oe-auto-prep.ts`) completa esa OE:
   - **Encabezado desde el trabajo**: producto, cliente, cantidad en kg (solo si la unidad es kg, nunca se convierte) y lote de fabricación **exacto**.
   - **Fórmula** (`lib/formulas/resolve-for-work.ts`):
     1. Primero el banco: coincidencia exacta o alias único.
     2. Si no está en el banco, Drive: **una única** planilla cuyo producto coincide exacto en la carpeta del cliente.
     3. Nunca por parecido. Si es **ambigua, está en conflicto, incompleta** (falta algún %, o el total no da 100 % ± 2) **o no se puede leer**, no se usa.
   - **Lotes de MP** (orden de búsqueda):
     1. el Control semanal vinculado a la OE;
     2. el que esta OE ya usó;
     3. el **único** control activo del mismo cliente + producto + kg que ninguna otra OE haya tomado.

     Con dos controles posibles, o con dos lotes distintos para el mismo código, no se elige. **Nunca se elige un lote por disponibilidad de stock.**
   - **kg a pesar** se calculan como siempre (4 decimales).
   - `autoPrep` registra:
     - fórmula, origen (Banco o Drive), versión o hash, archivo, hoja y fecha;
     - el control usado y el origen de cada lote (Control semanal, a mano o pendiente);
     - la lista de **pendientes**.
4. Producción ve el resultado en el mismo diálogo, por ejemplo «OE preparada. Falta: Lote de MP pendiente: Perfume floral».

Si la preparación falla, la asignación igual queda guardada y la OE se puede completar después con la acción explícita.

### Pendientes (nunca se inventa nada)
- **Sin fórmula, ambigua o ilegible**: la OE se crea igual, sin materias primas, con el motivo.
- **MP sin lote**: queda vacío y marcado.
- **Sin lote de fabricación**: queda pendiente.
- **Cantidad en unidades**: kg pendiente.
- **Control semanal armado para otros kg**: se conservan los lotes, con el aviso «confirmá los lotes con Materias Primas».

### Cambios del trabajo
- **Antes de empezar la elaboración** (OE en BORRADOR o PENDIENTE y sin registros del proceso: ajustes, control de proceso, calidad u observación), una corrección del trabajo **re-sincroniza la OE**. Aplica a producto, cliente, cantidad y lote, desde la tarjeta o desde la planilla.
  - Se recalculan los kg.
  - Se conservan los lotes de MP escritos a mano.
  - Si cambia el producto y no hay fórmula para el nuevo, se quitan las MP de la fórmula anterior.
- **Después de empezar**: **no se reemplaza nada** (fórmula, lotes ni cantidades). Queda auditado `OE_AUTOPREP_SKIPPED_STARTED`.
- **«Actualizar desde fórmula y lotes»** es la acción explícita para Producción o Elaboración:
  - primero muestra **qué cambiaría** (vista previa, sin guardar);
  - recién aplica al confirmar, con control de versión (409 si la OE cambió mientras se revisaba);
  - conserva los ajustes con su motivo, los lotes escritos a mano y todos los datos del proceso;
  - si la fórmula nueva no incluye una MP que ya tiene un ajuste registrado, no aplica.
  - Calidad y Materias Primas no pueden usarla (403).

### Pantalla del elaborador
Panel «Preparada desde el trabajo asignado» con:
- producto, lote de fabricación y cantidad;
- fórmula, origen, hoja, versión y fecha;
- origen de los lotes de MP;
- **Falta completar (N)**, calculado con lo que está en pantalla: al escribir un lote, ese pendiente desaparece.

En la tabla de materiales, el lote pendiente aparece resaltado en rojo con el texto «Pendiente». El elaborador completa solo los datos del proceso, como siempre.

### Seguridad
- **Drive y banco**: solo lectura. **Control semanal**: solo lectura (no se escribe `linked_oe_id`; Materias Primas mantiene su control).
- **Stock**: ningún movimiento. El consumo sigue siendo una sola vez, al entregar.
- **Concurrencia**:
  - la preparación bloquea la fila de la OE (`FOR UPDATE`) y sube la versión;
  - se compara contra el contenido guardado sin importar el orden de las claves (jsonb), así que **un reintento no cambia nada ni duplica la auditoría**.
- **Auditoría**:
  - `order_versions` guarda el snapshot completo (eventos `autoprep` / `autoprep_manual`);
  - `order_audit_events` registra `OE_AUTOPREP_APPLIED`, `OE_AUTOPREP_SKIPPED_STARTED` y `OE_AUTOPREP_MANUAL_REFRESH`, con la referencia de la fórmula (no su contenido), los lotes antes y después y los pendientes.
- `autoPrep` lo escribe **solo el servidor**: un guardado desde la pantalla no lo puede cambiar.
- **Corrección del defecto latente**: los ids de Drive ya no se guardan en las columnas uuid. La referencia queda en `formula_version_hash` y en `autoPrep`.
- **Permisos sin cambios**:
  - solo Producción y Dirección asignan;
  - Elaboración edita solo los datos operativos;
  - la acción explícita es para Producción, Dirección y Elaboración.

## 3. Validación

Todo en Postgres **descartable**: no se tocaron datos de Production.

| Prueba | Resultado |
|---|---|
| Unitarias nuevas (`oe-auto-prep-rules.test.ts`, `work-formula-rules.test.ts`) | 22 + 5 |
| Integración Postgres nueva (`oe-auto-prep.db.integration.test.ts`, dentro de `npm run test:e2e:produccion-edicion-db`) | **14/14** (suite completa 67/67) |
| E2E nuevo `GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:oe-automatica` (Chromium, build de producción, usuarios reales de Producción, Elaboración, Calidad y Materias Primas) | **35/35** |
| Regresión E2E usabilidad Elaboración / MP (`test:e2e:usabilidad`) | 26/26 |
| Vitest completo | 2194 OK (108 saltados: necesitan base) |
| `next build` (misma configuración que Vercel) | OK |

Casos de integración:
- fórmula completa + lotes, con 5 filas (la misma MP en dos fases);
- reintento sin duplicados;
- control ya usado por otra OE;
- sin fórmula;
- fórmula incompleta;
- ambigua e ilegible;
- fórmula de Drive con ids no-uuid;
- cambio del trabajo antes de empezar (cantidad con coma 1.234,5 y lote);
- cambio después de empezar, más la acción explícita (vista previa, versión vieja → conflicto, confirmación que conserva lo registrado);
- dos asignaciones simultáneas con el mismo N° de OE;
- doble clic (misma clave);
- dos preparaciones simultáneas;
- cantidad en unidades;
- **libro mayor y saldos de MP idénticos al final**.

Capturas en `docss/img/oe-automatica/`.
