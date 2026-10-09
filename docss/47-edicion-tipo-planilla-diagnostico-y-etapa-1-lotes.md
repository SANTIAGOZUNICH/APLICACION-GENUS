# 47 — Edición tipo planilla en GENUS OS: diagnóstico por módulo y Etapa 1 (Asignación de lotes)

Estado al 2026-10-09. Rama `claude/edicion-tipo-planilla`, que parte de `main` con el PR #111 ya mergeado.
La migración nueva es **0043**, aditiva: solo agrega columnas nullable y una tabla.

## 1. Diagnóstico por módulo

| Módulo | Fuente actual | Editable hoy | Bloqueado hoy | Calculado | Afecta stock | Riesgos encontrados | Solución |
|---|---|---|---|---|---|---|---|
| **Asignación de lotes** | `asignacion_lotes` en Postgres, sincronizada desde Google Sheets (upsert por lote+código+producto) más altas manuales y pegado | Filas manuales: todas las columnas según sector | **Todas las filas que vienen de Google** (candado), porque el próximo sync las pisaba | Origen | No (el lote del trabajo vive en `work_items`) | Editar lote/código/producto hacía que el sync creara un duplicado y archivara el original. `replaceAll` borraba todo. | **Etapa 1 (este PR)**: capa de ediciones de GENUS. Ver §2. |
| **Ingresos ME** | `inv_me_ingresos` (jsonb), solo GENUS (sin Google) | Formulario modal | **Planilla con candado en todo**: la vista no pasa la edición por celda | TOTAL = bultos × cantidad | **Sí**: suma al stock por código | Numeración `length+1` repetible; el modo planilla dice «tu sector no puede editar» incluso a Depósito | Etapa 2: edición por celda con el MISMO servicio (`upsertMeIngreso`), recálculo de stock y auditoría; TOTAL calculado |
| **Salidas ME** | `inv_me_salidas` (jsonb) | Formulario (solo MANUAL) | Planilla con candado; salidas de OA solo se revierten | TOTAL | Solo las de **OA** descuentan (las manuales no) | El formulario dice «obligatorio para descontar», pero las manuales no descuentan | Etapa 2: edición por celda de manuales; salidas de OA solo por reverso; aclarar el texto |
| **Inventario ME** | `inv_me_materials` + cálculo | Cliente, insumo, ubicación | Código, bultos, cantidad (calculadas) | **Stock = ingresos − salidas OA + ajustes** | Es el resultado | No hay UI de ajuste ME (el servicio `adjustMeStock` existe). Stock mínimo y punto de reposición no tienen UI. | Etapa 2: «Ajuste de inventario» auditado (motivo) que crea un movimiento; nunca editar el saldo directo; columnas de umbrales |
| **Graneles (Depósito)** | `deposito_graneles` | Producto, cliente, lote, kg, fecha, ubicación, observación (Depósito) | Filas que vienen de Envasado: identidad y kg | Estado AGOTADO | kg disponibles | `update()` sin versión condicional | Etapa 2: planilla por defecto + escritura condicional por versión |
| **Stock MP** | `inv_mp_stock` (jsonb) **y** libro mayor `mp_stock_balances`/`mp_stock_movements` | Proveedor, cliente, descripción, kg (con motivo), ubicación, lote, vencimiento | Lotes de origen «ingreso»: kg, lote y vencimiento | Estado, días al vencimiento | **Sí** | **Dos stocks que no se reconcilian.** El formulario pisa kg sin ajuste ni libro mayor. | Etapa 3: una sola fuente (libro mayor); kg solo por ajuste o corrección de ingreso |
| **Ingresos MP** | `inv_mp_ingresos` (jsonb) | Formulario | Planilla con candado | TOTAL | **Sí** (confirmado → stock y libro mayor) | Se auto-confirma al guardar. **Pegar dos veces duplica stock** (no hay dedupe). Varios lotes se acumulan en un solo lote de stock. | Etapa 3: borrador por defecto en planilla, confirmación explícita, dedupe por remito+código+lote, edición de confirmados por corrección (delta) |
| **Compras MP** | `inv_mp_compras` (jsonb) | Formulario | Planilla con candado | — | No | Sin control de versión | Etapa 3: edición por celda con versión |
| **Control semanal MP** | `mp_weekly_controls` + líneas | kg editados, lote, preparado, observación (solo borrador, solo Materia Prima) | Completado / anulado | kg necesarios, diferencia, estado | No descuenta | El stock de las líneas queda siempre en 0. `update()` sin versión. Borrar e insertar líneas sin transacción. | Etapa 3: leer stock real del libro mayor; versión y transacción |
| **Semanas (Producción)** | Planilla SEMANAS 2026 en vivo (lectura) + prioridades y vínculos en GENUS | Prioridad, vínculos, crear trabajo | Texto de la planilla (escritura a la original bloqueada en Production, a propósito) | — | No | No hay un identificador estable por tarea | Etapa 4: la planificación editable vive en `work_items` (PR #111). Sigue el aviso «Difiere de Semanas». Sin sincronización falsa. |

## 2. Etapa 1 — Asignación de lotes: filas de Google editables sin que el sync las pise

**Mecanismo: capa de modificaciones persistentes** (migración 0043):

- **`asignacion_lotes_local_edits`**: cuando GENUS cambia un campo de un registro sincronizado, se guarda una fila con estos datos:
  - `local_value`: el valor de GENUS;
  - `sheet_value`: lo que tenía la planilla en ese momento;
  - quién lo cambió y cuándo.
  
  Hay una sola fila abierta por registro y campo (índice único parcial).
- **`asignacion_lotes.source_lote/codigo/producto`**: guardan la identidad del registro **tal como está en la planilla**. El sync encuentra el registro por esa identidad aunque GENUS haya corregido lote, código o producto, así que no se duplica ni se archiva.
- **`asignacion_lotes_cell_audit.reason`**: guarda el motivo cuando se informa.

**Política de sincronización:**

| Caso | Qué hace el sync |
|---|---|
| Campo **no** editado en GENUS | Lo actualiza desde la planilla, como siempre. |
| Campo editado en GENUS y la planilla sigue igual | **No lo pisa.** |
| Campo editado en GENUS y la planilla lo cambió **después** | **CONFLICTO**: guarda el valor nuevo de la planilla y no elige en silencio. |
| La fila desaparece de la planilla y tiene ediciones de GENUS | No la archiva sola: queda el aviso «ya no está en la planilla». |
| GENUS archivó una fila de Google | El sync no la revive. Restaurarla la vuelve a sincronizar. |
| `replaceAll` con ediciones de GENUS abiertas | Rechazado. |

**Decisiones** (con versión del registro y auditoría):
- **Mantener GENUS**: el valor nuevo de la planilla pasa a ser la base.
- **Usar planilla**: el campo toma ese valor y vuelve a seguir la planilla.
- **Volver a la planilla**: descarta la edición de GENUS.
- Para una fila que ya no está en la planilla: **conservarla** como registro de GENUS (deja de sincronizarse) o **archivarla**.

**Lo que no cambia:**
- No se escribe en Google. El write-back sigue igual: solo para fuentes habilitadas explícitamente y nunca en Production.
- La matriz de permisos por columna no cambia:
  - Calidad y Producción editan los datos del lote.
  - Muestras y análisis los edita solo Calidad.
  - Observaciones las editan también Codificado.
- Los lotes ya aprobados, rechazados, cerrados o entregados en algún trabajo siguen sin poder cambiar lote, producto, código ni VTO. El procedimiento de corrección es el del PR #111.

**En pantalla:**
- La grilla queda sin candados en las columnas permitidas.
- Celda editada en GENUS: borde verde agua.
- Celda en conflicto: fondo ámbar.
- La columna «Origen» indica «editado en GENUS» o «⚠ conflicto».
- Un panel lista los conflictos con los botones de decisión.
- El formulario también registra la edición como edición de GENUS.
- Se mantienen sin cambios:
  - doble clic, Enter, Tab y flechas;
  - selección de rangos;
  - copiar y pegar desde Excel;
  - deshacer;
  - historial por lote;
  - «Nuevo lote»;
  - pegado e importación.

## 3. Alerta «FALTAN DATOS DE PACKING»

Se quitó **solo** el cálculo de esa advertencia en `lib/planning/work-item-warnings.ts`. Era puramente visual y ninguna acción dependía de ella.

Siguen igual:
- falta lote, VTO, cantidad final y sobrante;
- el cierre de envasado con diferencias (`assertPackagingCloseOrExplained`);
- los faltantes de remito;
- muestras, finalizaciones y Calidad.

Los datos de packing guardados no se tocan.

## 4. Validación de la Etapa 1

| Prueba | Resultado |
|---|---|
| Unitarios lotes | 189 OK (nuevo `asignacion-lotes-local-edits.test.ts`, 7 casos) |
| Integración Postgres (`npm run test:e2e:produccion-edicion-db`) | **23/23**: migración 0043 idempotente; editar → recargar → re-sincronizar; conflicto y «usar planilla»; identidad; concurrencia; fila eliminada; permisos |
| Navegador (`npm run test:e2e:asignacion-lotes`) | **20/20**: sin candados; doble clic + escribir; recargar y encontrar el valor exacto; marca; pegado de rango; deshacer; historial; conflicto y «Mantener GENUS»; alta; 409; Calidad / Codificado / Envasado; ninguna escritura a Google |
| Regresión | Producción edita 27/27, Mi trabajo 50/50, sectores y TV 37/37, vitest 2114, build OK |

Capturas en `docss/img/asignacion-lotes-edicion/`.

## 5. Próximas etapas (cada una con el mismo nivel de pruebas)

- **Etapa 2 — Depósito ME:**
  - planilla editable en Ingresos y Salidas manuales, por los servicios existentes;
  - ajuste de inventario ME auditado;
  - umbrales;
  - escritura condicional por versión.
- **Etapa 3 — Materias primas:**
  - unificar el stock en el libro mayor;
  - ingresos en borrador con confirmación explícita y dedupe;
  - correcciones por delta;
  - Compras y Control semanal con versión.
- **Etapa 4 — Semanas:** seguir con la planificación editable en GENUS (`work_items`), sin escribir en la planilla original.
