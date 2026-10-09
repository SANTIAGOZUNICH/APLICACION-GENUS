# 50 — Etapa 3: Materias Primas como planillas editables (Ingresos, Stock, Compras y Control semanal)

Estado al 2026-10-09. Rama `claude/mp-planilla-etapa3`, que parte de `main` en cce18d1 (incluye #112, #114 y #113). **Sin migraciones.** No se modifica stock de Production ni se reconcilian saldos de forma automática.

## 1. Diagnóstico

| Problema | Dónde | Efecto |
|---|---|---|
| Cada request hidrataba una copia en memoria **compartida**, la modificaba y **re-escribía todas las filas de MP** (stock, ingresos, control, compras). Cualquier POST de inventario, también de ME, lo hacía. | `neon-persist.ts` (`persistInventorySnapshot`, `persistMpStockSnapshot`) | «Gana el último»: un guardado de MP podía ser pisado por otro request que nada tenía que ver. |
| El libro mayor leía el saldo y lo reescribía **sin transacción ni candado**, y cualquier error se convertía en «esquema pendiente». | `mp-stock-ledger.ts` (`applyMovement`) | Dos movimientos del mismo código a la vez: se perdía uno. La causa real de los errores quedaba oculta. |
| El lote (JSONB) y el libro mayor se escribían **en conexiones separadas**. | servicio de inventario + libro mayor | Un error a mitad de camino dejaba los dos stocks distintos. |
| «Ajustar stock», la celda de kg y el formulario cambiaban los kg del lote **sin pasar por el libro mayor**. El formulario pisaba los kg sin ajuste. | `adjustMpStock`, `upsertMpStock` | Dos stocks que no concilian. |
| **Consumo de OE sin stock suficiente: se perdía en silencio.** El movimiento fallaba, `catch {}` lo descartaba y los códigos siguientes de esa OE tampoco se descontaban. | `orders-service.ts` | El stock quedaba más alto que el real, sin aviso. |
| Ingresos: pegar dos veces el mismo remito duplicaba el stock. Todo ingreso con cantidad se confirmaba solo. El Nº salía de `cantidad + 1` y se podía repetir. | `upsertMpIngreso` | Stock duplicado. Números repetidos. |
| Ingresos y Compras con candado en la planilla (solo formulario, sin versión). | `mp-hub-view.tsx` | No se podía trabajar «como Excel». |
| Control semanal: el stock de las líneas quedaba **siempre en 0**, porque el cliente nunca lo mandaba. Además:<br>• `update()` sin versión;<br>• control y líneas se borraban e insertaban **sin transacción**;<br>• la auditoría solo se escribía al crear. | `mp-control-service.ts` | Todo figuraba «falta». Dos guardados se pisaban. Un error podía dejar el control sin líneas. |
| Libro mayor: cualquier sector autenticado podía leerlo y registrar saldos iniciales. | `/api/v1/mp-stock/ledger` | Permisos más amplios que la pantalla. |

## 2. Qué se hizo

**Una transacción por operación de MP** (`mp-planilla-db.ts` → `runMpInventoryOp`). Todo pasa por acá: formulario, pegado, planilla, anular, compras, «Ajustar stock» y confirmar.
1. Abre una transacción con un candado de MP (`pg_advisory_xact_lock`).
2. Lee las tablas de MP dentro de esa transacción, en un repositorio propio del request.
3. Ejecuta el **mismo** `InventoryService` de siempre. No hay una segunda copia de las reglas.
4. Los movimientos del libro mayor usan esa misma transacción (transacción ambiente, `tx-context.ts`).
5. Cada ajuste de kg de un lote genera el mismo delta en el libro mayor.
6. Escribe solo las filas que cambiaron, condicionadas a su versión, más la auditoría. O se confirma todo o nada.

**Libro mayor atómico:**
- candado por código, saldo leído con `FOR UPDATE` e idempotencia verificada dentro del candado;
- los errores reales se informan tal cual. Solo «tabla o columna inexistente» es esquema pendiente.

**Persistencia:** los POST de otros módulos ya no re-escriben filas de MP que no tocaron. Es el mismo mecanismo de la Etapa 2 para ME.

**Ingresos MP (planilla editable):**
- Se editan fecha, proveedor, cliente, remito, código, producto, descripción, bultos, cantidad, ubicación, lote y vencimiento. INGRESO Nº y TOTAL son calculados.
- **Borrador:** se edita sin mover stock. Editar ya no lo confirma.
- **Confirmado:** corregir código, bultos, cantidad o lote es una **corrección con motivo** (queda en la auditoría). Mueve el lote y el libro mayor solo por la diferencia.
- **Pegado:** entra como **borrador**. Los duplicados (mismo remito, código, lote, cantidad y fecha) se rechazan y se informan, y el resto se carga. «Confirmar N borradores» los suma al stock con control de versión. Confirmar dos veces no suma dos veces.
- Nº de ingreso: el mayor existente más uno.

**Stock MP:**
- nueva columna **«Stock código»**: saldo real del código según el libro mayor (ingresos − consumos de OE ± ajustes), con los negativos en rojo;
- «Kg lote» es lo ingresado o ajustado en ese lote;
- los kg se corrigen solo con motivo (celda o «Ajustar stock») y el ajuste queda en el libro mayor;
- el formulario ya no pisa los kg de un lote existente;
- el alta manual con kg queda como ajuste.

**Compras MP:** se edita cada celda con versión (409 si cambió) y auditoría. El estado se elige de la lista. Una compra cancelada solo cambia estado y nota.

**Control semanal:**
- stock real del libro mayor al crear o recalcular, y en vivo mientras está en borrador;
- el control queda como estaba al completarse;
- `update` con `expectedVersion` (409);
- control y líneas en **una transacción**, condicionada a la versión anterior;
- la auditoría se actualiza en cada edición.

**Consumo de OE:** se registra siempre. Si deja un código en negativo, queda visible y avisa a Materia Prima y a Producción. Los errores que no son de esquema quedan en el log.

**Permisos del libro mayor:**
- **Leer:** mismos sectores que Stock MP.
- **Saldo inicial:** solo quien escribe Stock MP (Materia Prima y Dirección).
- **Ingresos y Compras:** siguen siendo solo de Materia Prima y Dirección.

## 3. Qué NO se hizo (a propósito)

- **No se reconcilió** el stock JSONB con el libro mayor en los datos existentes. Igualarlos implicaría mover kg en Production, y eso no se hace sin autorización. La diferencia queda **visible**: «Kg lote» y «Stock código» en la misma fila. Se corrige con «Ajustar stock» (con motivo) cuando corresponda.
- No hay migraciones nuevas: usa `inv_mp_*`, `mp_stock_*`, `mp_weekly_*`, `inv_ajustes` e `inv_audit`.

## 4. Validación

| Prueba | Resultado |
|---|---|
| Unitarias nuevas (`mp-etapa3.test.ts`) | 12/12 |
| Postgres descartable (`mp-planilla.db.integration.test.ts`) | 13/13 |
| Chromium, build de producción (`GENUS_E2E_PRODUCTION_BUILD=1 npm run test:e2e:mp-planilla`) | 24/24 |

Qué cubre la integración contra Postgres:
- lote y libro mayor en la misma transacción, con rollback total;
- 20 movimientos simultáneos sin pérdida;
- pegado en borrador y duplicado rechazado;
- confirmación idempotente;
- corrección con motivo por delta;
- edición simultánea con un 409;
- ajuste y alta manual reflejados en el libro mayor;
- consumo de OE sin stock registrado en negativo;
- un snapshot viejo que ya no pisa MP;
- Compras con versión y auditoría;
- permisos;
- Control semanal con stock real, versión, transacción y auditoría.

Qué cubre el E2E en Chromium:
- ingreso por formulario;
- pegado en borrador y duplicado rechazado;
- planilla editable con columnas calculadas protegidas;
- borrador editado sin stock, «Confirmar borradores» y corrección con motivo;
- valor conservado al recargar;
- 409 con versión vieja;
- «Stock código»;
- «Ajustar stock» que mueve lote y libro mayor;
- el formulario no pisa los kg;
- Compras;
- Control semanal con stock real y 409;
- Producción y Envasado según permisos.

Capturas en `docss/img/mp-planilla/`.

Regresión sobre el mismo código:
- E2E de Depósito: 25/25.
- E2E de Asignación de lotes con build de producción: 30/30.
- Integración contra Postgres (Semanas, Producción, lotes 0043, Depósito y MP): 45/45.
- Vitest completo: 2147 OK.
- `tsc` sin errores fuera de los tests y lint sin errores nuevos. Los errores que aparecen ya estaban en `main`.
