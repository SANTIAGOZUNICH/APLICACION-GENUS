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

Borrarlo o archivarlo queda para cuando lo autorices, con el resultado del diagnóstico.

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

Ver el PR.

E2E `GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:planillas-celda`:
- Agrega una fila **igual a las de Production**: lote existente con `origen: "ingreso"`, payload previo a esta corrección (sin `producto`) e ingreso CONFIRMADO vinculado.
- Se inserta sin movimientos de libro mayor.
- Con el usuario **Materia Prima**: doble clic en **PRODUCTO**, Proveedor y Descripción → escribir → Enter → PostgreSQL → recarga.
- Verifica:
  - sin diálogos;
  - kg sin cambios y sin movimientos;
  - auditoría;
  - motivos específicos en Kg y Código;
  - fila «..» marcada.
- En las siete tablas, cada edición comprueba además que **no se abrió ningún diálogo**.
