# 51 — Bug en Production: las planillas de Depósito y Materias Primas no se editaban en la celda

Estado al 2026-10-09. Rama `claude/fix-edicion-celda-planillas`, que parte de `main` en 523d7ba (incluye #113 y #115). **Sin migraciones ni cambios de datos.**

## 1. Causa exacta

La planilla editable (GenusGrid, la misma de Asignación de lotes) existía en las 7 tablas. Pero `OperationalTable` y `ExcelOrList` deciden si mostrar **planilla o lista** según una preferencia guardada en el navegador, y esa preferencia era **una sola clave para todas las tablas**: `localStorage["genus_os_table_mode"]`.

- Antes de las Etapas 2 y 3, estas tablas eran planillas de **solo lectura**. Para editar había que usar los botones de la lista, así que tenía sentido tocar «Ver como lista» en cualquier tabla.
- Desde ese momento, **todas** las tablas que usan esa preferencia abrían como lista. La lista solo tiene botones Editar, formularios y modales: no hay edición en la celda.
- **Asignación de lotes** usa `GenusGrid` directamente, sin esa preferencia, y por eso sí se podía editar en la celda.

**Por qué los E2E daban verde:** cada prueba abría un navegador nuevo, sin preferencias guardadas, y con una pantalla de 2200 a 2400 px. Siempre veían la planilla. La condición real de Production (preferencia «lista» ya guardada) nunca se probaba.

Reproducido en un navegador real, con la preferencia vieja guardada: Compras MP mostraba 0 grillas y 1 tabla HTML.

Revisé también otras causas posibles y no aplican: permisos (las celdas permitidas no tienen candado), grillas alternativas (no hay otra) y el modo «Seleccionar». Este último fuerza la lista a propósito para la selección múltiple, no queda guardado y se sale con «Cancelar».

## 2. Corrección

- **Preferencia POR TABLA** (`genus_os_table_mode:<tabla>`). Una tabla **editable** abre siempre como planilla, salvo que el usuario elija la lista **en esa tabla**. La clave global vieja solo se respeta en tablas de solo lectura.
- Si una tabla editable está en modo lista, se muestra un aviso visible: «Esta tabla se edita directamente en las celdas… **Editar en la planilla**».
- **Tab / Shift+Tab** pasan a la siguiente celda **editable** y saltean las protegidas. Antes caían en columnas calculadas.
- Las **columnas calculadas** dicen por qué no se editan: candado en la celda, motivo al pasar el mouse y aviso si se intenta editarlas. Por ejemplo:
  - «TOTAL = bultos × cantidad: se calcula solo»;
  - «Stock calculado (ingresos − salidas ± ajustes): se corrige con Ajustar stock»;
  - «Saldo del libro mayor…»;
  - «Número asignado por el sistema»;
  - «Viene de la fórmula».

Lo que ya funcionaba se mantiene:
- doble clic o escribir para editar en la celda; Enter guarda; Escape cancela;
- Ctrl+C / Ctrl+V de celdas y rangos (Excel y Google Sheets);
- guardado en PostgreSQL con versión (409), auditoría y todo-o-nada;
- motivo obligatorio cuando el cambio mueve stock.

## 3. Qué se edita en cada tabla

| Tabla | En la celda | Protegido (motivo visible) |
|---|---|---|
| Ingresos ME | fecha, Nº, proveedor, cliente, remito, código, insumo, bultos, cantidad, ubicación | TOTAL; anulados |
| Salidas ME | manuales: fecha, Nº, cliente, remito, código, descripción, bultos, cantidad, unidad, control, entregado, comentarios, motivo, descuenta | TOTAL; salidas de OA |
| Inventario ME | descripción, cliente, ubicación, unidad, cant. por bulto, stock mínimo, punto de reposición, responsable, observación | código, bultos y cantidad total (se ajustan con motivo, auditado) |
| Ingresos MP | fecha, proveedor, cliente, remito, código, producto, descripción, bultos, cantidad, ubicación, lote, vencimiento | Ingreso Nº, TOTAL; anulados. En confirmados, código, bultos, cantidad y lote piden motivo |
| Stock MP | proveedor, cliente, descripción, ubicación, lote, vencimiento; kg con motivo (ajuste auditado) | código, producto, stock código (libro mayor), estados, días; en lotes de ingreso, los datos del documento |
| Compras MP | todas | canceladas: solo estado y nota |
| Control semanal MP | kg editados, lote, preparado, observación (borrador, Materia Prima) | código, materia prima, %, stock, proyectado, diferencia, estado |

## 4. Validación

**E2E nuevo** `GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:planillas-celda` (desde `frontend/`): build de producción, Chromium, Postgres descartable, pantalla de **1440×900** y la **preferencia vieja «lista» ya guardada**.

Por cada una de las 7 tablas:
1. abre como planilla;
2. doble clic en una celda existente, escribir y Enter;
3. el valor está en PostgreSQL;
4. al recargar, la celda muestra el valor.

Además:
- columnas calculadas con candado y motivo;
- Escape cancela;
- Tab guarda y salta Ingreso Nº hasta Proveedor;
- pegado de un rango de 2 filas desde Excel;
- auditoría por edición;
- versión vieja → 409;
- permisos (Producción → 403);
- la preferencia por tabla no afecta a las demás tablas;
- «Editar en la planilla» vuelve a la planilla.

Solo se editaron campos administrativos y borradores: **no se movió stock**.

**Resultado: 38/38 OK** (build de producción).

Capturas en `docss/img/planillas-edicion-celda/` (una por tabla, después de recargar).

Regresión sobre esta rama:

| Prueba | Resultado |
|---|---|
| Vitest completo (incluye 4 nuevas de `table-mode.test.ts`) | 2151 OK |
| E2E Materias Primas, build de producción (`test:e2e:mp-planilla`) | 24/24 |
| E2E Depósito (`test:e2e:deposito-me`) | 25/25 |
| E2E Asignación de lotes, build de producción | 30/30 |
| Lint de los archivos tocados | sin errores nuevos |
