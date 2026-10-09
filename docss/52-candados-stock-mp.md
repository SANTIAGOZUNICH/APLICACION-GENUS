# 52 — Bug en Production: celdas de Stock MP con candado (PRODUCTO, Proveedor, Descripción…)

Estado al 2026-10-09. Rama `claude/fix-candados-stock-mp`, que parte de `main` en e79b5ba (incluye #116). **Sin migraciones y sin cambios de datos.**

## 1. Qué condición generaba cada candado (antes)

Una celda de Stock MP se editaba solo si se cumplían dos cosas:
- la columna estaba en `MP_STOCK_CELL_FIELDS` (`mp-hub-view.tsx`);
- la celda pasaba `inventoryCellProtection` (`lib/inventory/cell-edit.ts`).

| Columna | Usuario Materia Prima, lote existente creado por un ingreso (como en Production) | Condición exacta |
|---|---|---|
| **PRODUCTO** | 🔒 siempre | **Tipo de columna**: no era un dato guardado. Se calculaba al listar (`productosAsociados` = productos de los ingresos CONFIRMADO del mismo código), así que no tenía campo editable. |
| Proveedor, Descripción, Lote, Vencimiento | 🔒 | **Origen del registro**: `origen === "ingreso"` → «Dato del documento de ingreso: se corrige en el ingreso». |
| Kg lote | 🔒 | **Origen**: lote de ingreso → «usá Ajustar stock». |
| Cliente, Ubicación | editable | — |
| Código, Stock código, estados, días, origen | 🔒 | **Columna calculada / identidad**. |

**Permisos y estado no eran la causa.** Materia Prima tiene permiso de escritura en Stock MP. Los lotes archivados no se listan.

Había además un problema que no se veía como candado: Proveedor, Cliente, Descripción, Lote y Vencimiento estaban marcados como «sensibles». Cada edición abría un **diálogo de confirmación**, es decir un modal, aunque la celda estuviera libre.

## 2. Por qué el E2E editaba Ubicación y Production no puede editar Producto

- El E2E creaba un lote **manual** (`origen: "manual"`) y editaba **Ubicación**: la única columna que no tenía ninguno de los dos bloqueos.
- En Production los lotes son **existentes y creados por ingresos confirmados** (`origen: "ingreso"`). En esos lotes estaban bloqueadas PRODUCTO (siempre) y Proveedor, Descripción, Lote y Vencimiento (por el origen).
- El helper del E2E aceptaba solo el diálogo de confirmación si aparecía. Por eso tampoco detectaba los modales.

Sí: los registros existentes tenían restricciones distintas de los creados en las pruebas.

Además, el bloqueo por origen no tenía forma de resolverse:
- Mandaba a «corregir en el ingreso», pero el lote de Stock se agrupa **por código** (`resolveMpLot` → `findMpStockByCodigo`).
- Corregir el ingreso **no vuelve a copiar** proveedor, descripción, lote ni vencimiento al lote.
- El dato quedaba trabado, sin camino para cambiarlo.

## 3. Corrección

- **PRODUCTO editable**: nuevo campo guardado `producto` en el payload JSONB del lote, sin migración.
  - La columna muestra lo escrito por Materia Prima.
  - Si está vacío, muestra como antes los productos de los ingresos confirmados del código.
- **Lotes creados por ingresos**: Producto, Proveedor, Cliente, Descripción, Ubicación, Lote y Vencimiento se editan en la celda, con auditoría (valor anterior y nuevo, usuario).
- **Sin diálogos para datos administrativos**: se guardan con Enter y se deshacen con Ctrl+Z. Solo los **kg** piden confirmación y motivo.
- **Siguen protegidos, con motivo específico**:
  - Kg de un lote de ingreso: «se corrigen con Ajustar stock (motivo, queda en el libro mayor) o corrigiendo el ingreso».
  - Kg de un lote manual: en la celda, pero con motivo obligatorio. Quedan como ajuste en el libro mayor.
  - Código: «identifica el saldo en el libro mayor: cambiarlo movería stock entre códigos».
  - Stock código, estados, días y origen: calculados, con su motivo.

## 3 bis. Segunda causa: filas existentes que NO se podían guardar (precisión del timestamp)

La primera corrida del E2E usó filas insertadas en la base como están en Production, no creadas por la app. Ahí **todas las ediciones fallaban** con «otro usuario modificó este registro», sin ningún candado a la vista.

- **Causa:** el control de versión de MP compara `updated_at` de la tabla.
  - Postgres guarda **microsegundos**, pero JavaScript lo lee **truncado a milisegundos**.
  - En una fila escrita por SQL (`now()`, importación, migración), la condición `updated_at = <leído>` **nunca** coincidía.
  - Resultado: conflicto permanente y la fila no se podía editar nunca. Las filas creadas por la app no lo sufren porque se escriben con milisegundos.
- **Corrección:** se compara al milisegundo (`date_trunc('milliseconds', updated_at)`) en Stock, Ingresos, Compras y Control semanal.
- **No habilita pisar cambios concurrentes:**
  - la versión del registro (`updatedAt` del payload, que cambia en cada guardado) se valida primero;
  - las operaciones de MP están serializadas por un candado (`pg_advisory_xact_lock`);
  - una escritura de afuera entre la lectura y el guardado cambia `updated_at` y da conflicto.

  Probado en Postgres (ver §6).

## 3 ter. Fuente de verdad: Stock MP vigente, Ingreso MP como documento original

| Registro | Qué representa | Se corrige en |
|---|---|---|
| **Lote de Stock MP** | **Dato VIGENTE** del material en planta: producto, proveedor, descripción, lote, vencimiento, ubicación (y kg, por libro mayor). | La celda de Stock (kg: «Ajustar stock»). |
| **Ingreso MP** | **Documento de recepción**: lo que llegó con el remito. Al corregir Stock **no se reescribe**, y conserva la trazabilidad del ingreso original. | Ingresos MP. Sus correcciones de código, cantidad o lote (con motivo) mueven el stock por diferencia; sus datos administrativos no pisan el lote. |

- Nunca hay dos datos «vigentes»: cuando difieren, **las dos celdas lo marcan** (esquina azul y texto al pasar el mouse).
  - En Stock: «Dato vigente (corregido en Stock MP). En el ingreso MP-I-… (remito …) se recibió: «X». El ingreso conserva el dato original».
  - En el ingreso original: «Dato recibido en este ingreso (documento). El dato vigente del lote en Stock MP es «Y»».
- La auditoría de cada celda de Stock guarda el valor anterior y el nuevo, con usuario y fecha.

**Quién usa cada dato** (revisado en el código):
- **Vencimientos:** «Días al vence» y «Estado vencimiento» se calculan del vencimiento **del lote de Stock**, es decir, del dato vigente. Probado: corregir el vencimiento en Stock recalcula los días y el ingreso conserva la fecha recibida.
- **OE (consumo) y Control semanal:** usan el **código** a través del libro mayor. El código sigue protegido: ninguna edición administrativa cambia lo que consume una OE ni el stock del control.
- **Libro mayor (trazabilidad de movimientos):**
  - los movimientos de ingreso guardan el lote y el proveedor del documento y no se reescriben;
  - los ajustes nuevos registran el lote vigente del Stock.
- **COA:** es la biblioteca de certificados (carpetas y archivos de Drive). No lee datos del lote ni del ingreso, así que no se ve afectado.

## 4. Fila con código «..»

No tengo acceso a la base de Production desde este entorno, así que **no puedo afirmar** de dónde salió. Por el código, las vías posibles son:

1. **Un ingreso MP con código «..»**: el código se aceptaba como código de negocio (solo se pedía que no estuviera vacío). Crea o reutiliza un lote con ese código, kg 0 si era borrador o la cantidad era 0.
2. **Un lote cargado por la planilla o importación** con «..» en la columna código.

Lo que hice, **sin borrar nada**:
- `scripts/_diag_mp_stock_codigo_invalido.mjs` (**solo lectura**) lista los lotes con un código sin letras ni números y, para cada uno:
  - la auditoría: quién lo creó y con qué acción;
  - los ingresos vinculados;
  - los movimientos del libro mayor.

  Con eso se sabe si es un registro real, una carga de prueba o un problema de importación.
- En la planilla, esos lotes se marcan **«Código inválido»**: no se ocultan ni se borran.
- Un ingreso nuevo con código «..», «-» o «.» se trata como **ingreso sin código de proveedor**: identidad interna y aviso «Sin código proveedor». Ya no crea un lote «..».

**No se borra ni se corrige automáticamente.** Borrarlo o archivarlo queda para cuando lo autorices, con el resultado del diagnóstico.

## 5. Las otras seis tablas

| Tabla | Candados | ¿Bloqueo equivalente? |
|---|---|---|
| Ingresos ME | TOTAL (calculado); anulados | No. Datos administrativos sin diálogo. |
| Salidas ME | TOTAL; salidas de una OA (se corrigen desde la OA) | No. Bloqueo legítimo con motivo. |
| Inventario ME | código, bultos y cantidad total (stock calculado → Ajustar stock) | No. |
| Ingresos MP | Ingreso Nº, TOTAL; anulados. En confirmados, código, bultos, cantidad y lote piden motivo (mueven stock). | No. Proveedor, producto, descripción, ubicación y demás se editan sin diálogo, también en confirmados (probado con un ingreso confirmado existente). |
| Compras MP | canceladas: solo estado y nota | No. |
| Control semanal MP | código, %, stock, proyectado, diferencia, estado; controles completados o anulados | No. Motivo específico por estado. |

## 6. Validación

| Prueba | Resultado |
|---|---|
| E2E Chromium, **build de producción**, 1440×900, preferencia vieja «lista» guardada (`GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:planillas-celda`) | **87/87** |
| Integración contra Postgres (Semanas, Producción, lotes, Depósito, MP) | **48/48** |
| Unitarias nuevas o ajustadas (`cell-edit.test.ts`, `mp-trazabilidad.test.ts`) | 6/6 y 4/4 |

E2E: fila **igual a las de Production**, con el usuario **Materia Prima**.
- La fila:
  - lote existente con `origen: "ingreso"`, insertado por SQL (timestamp con microsegundos);
  - payload anterior a esta corrección, sin `producto`;
  - ingreso CONFIRMADO vinculado;
  - sin movimientos de libro mayor.
- Doble clic → escribir → Enter → PostgreSQL → recarga en **Producto, Proveedor, Descripción, Lote y Vencimiento**, cada uno **sin diálogos**.
- El ingreso original conserva los cinco datos recibidos.
- Marcas «vigente / recibido» en Stock y en Ingresos.
- Ubicación igual al ingreso: sin marca.
- Kg sin cambios y sin movimientos; 5 ediciones auditadas.
- Kg y Código protegidos con su motivo específico.
- Fila «..» marcada «Código inválido» y no borrada.
- Ingreso CONFIRMADO existente editado en la celda, sin diálogo, sigue confirmado y sin movimientos.
- En las 7 tablas, cada edición verifica que **no se abrió ningún diálogo**.

Integración (Postgres real):
- fila con microsegundos que ahora se edita;
- **dos ediciones simultáneas** sobre esa fila: una guarda y la otra recibe 409, y una versión vieja también da 409;
- una **escritura externa** entre la lectura y el guardado da conflicto y no se pisa.

Capturas en `docss/img/candados-stock-mp/`.

Todo se hizo en Postgres descartable: **no se tocó stock ni registros reales de Production**.
