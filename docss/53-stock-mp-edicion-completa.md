# 53 — Stock MP: todas las columnas editables en la celda (como Excel)

Rama `claude/stock-mp-edicion-completa`, que parte de `main` en 6f72535 (incluye #117). **Sin migraciones**: el alias de códigos usa la columna `payload` (jsonb) que `mp_stock_balances` ya tiene, y los campos nuevos del lote y del ingreso van en sus payload JSONB.

## 1. Dependencias reales (investigadas en el código)

| Dato | Quién lo usa | Consecuencia para editarlo |
|---|---|---|
| **Código** | <ul><li>Clave del **libro mayor**: `mp_stock_balances.codigo` (PK) y `mp_stock_movements.codigo`.</li><li>**Ingresos MP**: `codigo` y `stockLotId`. Las correcciones y anulaciones de un ingreso confirmado mueven el saldo del código del ingreso.</li><li>**Consumo y reverso de las OE**: claves de idempotencia por OE + código; el reverso usa el código de los movimientos originales.</li><li>**Control semanal**: saldo por código de la fórmula.</li><li>**Fórmulas** (índice de Drive, externo): dan el código a OE y Control semanal.</li><li>**PRODUCTO** de Stock: ingresos confirmados del mismo código.</li></ul> | Cambiar solo el texto del lote dejaba el saldo en el código viejo. El reverso de una OE vieja, las correcciones de ingresos y las fórmulas seguían apuntando al código viejo. |
| **Kg lote** | El lote (`inv_mp_stock.cantidadKg`), los estados de stock y los ajustes (`inv_ajustes`). Cada ajuste genera el mismo delta en el libro mayor. | Solo se puede cambiar como ajuste con motivo, que queda en el libro mayor. |
| **Stock código** | Saldo del libro mayor del código: ingresos − consumos de OE ± ajustes. Lo usan el Control semanal y la columna de Stock. | Es calculado. Un valor «escrito» se perdería al recalcular, así que se cambia con un movimiento de ajuste por la diferencia. |
| **Días al vence / Estado vencimiento** | Se calculan del **vencimiento** del lote. | — |
| **Estado stock** | Se calcula de los **kg** del lote. | — |

## 2. Cómo se edita cada columna

En todas: doble clic → escribir → Enter guarda; Tab avanza a la celda siguiente; Escape cancela; pegado de rangos desde Excel. Todo queda auditado (valor anterior, nuevo, usuario, fecha) y persiste al recargar. **Ningún candado permanente**: solo bloquean el permiso del sector y los lotes archivados.

| Columna | Operación |
|---|---|
| Producto, Proveedor, Cliente, Descripción, Ubicación, Lote, Vencimiento, Origen | Se guardan directo. Sin diálogos y sin motivo. |
| **Kg lote** (también de lotes de ingreso) | El **motivo se pide dentro de la planilla**: barra en línea, sin ventana modal. Se escribe y Enter, o se elige «Conteo físico», «Corrección de carga», etc. Escape cancela. Ajusta el lote y registra el **AJUSTE** con ese motivo en el libro mayor. |
| **Stock código** | Mismo motivo en la planilla. Registra un **AJUSTE por la diferencia** entre el valor escrito y el saldo actual del código. **Si el saldo cambió desde que se vio → 409** y no se pisa. El lote no cambia. |
| **Código** | Mismo motivo en la planilla. **Reclasificación en UNA transacción**:<ul><li>el lote pasa al código nuevo y recuerda el anterior;</li><li>los ingresos vinculados pasan al código nuevo y conservan `codigoRecibido`;</li><li>en el libro mayor, un par de movimientos **RECLASIFICACION** (salida del viejo, entrada en el nuevo) traspasa el saldo.</li></ul>Si era el único lote del código, se traspasa **todo** el saldo y queda un **alias viejo → nuevo**: el consumo o el reverso de una OE anterior, el Control semanal y un ingreso que todavía llegue con el código viejo caen en el nuevo. Si hay otros lotes con el mismo código, se traspasan solo los kg del lote y no hay alias. **Los movimientos históricos no se modifican ni se borran.** |
| Días VTO | Fija el vencimiento en hoy + días. |
| Estado stock / Estado VTO | Estado **fijado a mano**, con una nota que muestra el calculado. Vaciar la celda vuelve al cálculo. Nunca cambia kg ni libro mayor. |

**Concurrencia:**
- versión de la fila (409);
- candado de MP y candados por código en orden fijo (dos reclasificaciones cruzadas no se bloquean);
- `updated_at` al milisegundo;
- saldo «visto» para Stock código.

Dos ediciones simultáneas: una gana y la otra recibe 409, con un solo traspaso.

## 3. Validación

Todas las pruebas usaron una base Postgres descartable: no se modificaron datos de Production.

| Prueba | Resultado |
|---|---|
| E2E nuevo `GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:stock-mp-completo` (Chromium, build de producción, usuario Materia Prima, fila existente de un ingreso confirmado con historia en el libro mayor, preferencia vieja «lista») | **47/47** |
| Integración Postgres (incluye 5 nuevas: reclasificación transaccional con historia intacta, alias para OE y para ingresos con el código viejo, Stock código con 409, kg de lote de ingreso, dos correcciones de código simultáneas) | **53/53** |
| E2E 7 tablas (`test:e2e:planillas-celda`) | **87/87** |
| Regresión Materias Primas / Depósito / Asignación de lotes | **24/24 · 25/25 · 30/30** |
| Vitest completo | **2164 OK** |

El E2E nuevo verifica:
- **Candados**: ninguna de las 14 columnas tiene candado.
- **Datos administrativos**: se guardan con Enter, sin diálogo, y siguen igual al recargar. Funcionan Tab y Escape.
- **Kg lote**: el motivo se pide en la planilla, el ajuste queda en el libro mayor y Escape en el motivo cancela.
- **Stock código**: genera un ajuste por la diferencia y el lote no cambia.
- **Código**: el lote y el ingreso pasan al código nuevo, el saldo se traspasa completo, se crea el alias y la historia queda idéntica.
- **Días VTO y estados**: funcionan como operación segura, y vaciar la celda vuelve al cálculo.
- **Otros**: pegado de un rango de 2 filas, 409 por versión vieja y por saldo visto viejo, auditoría, y Producción recibe 403.

Ajuste de pruebas existentes: verificaban el candado de Kg lote, Código y Stock código, que este cambio quita a propósito. Ahora verifican que esas celdas no tienen candado.

Capturas en `docss/img/stock-mp-edicion-completa/`.
