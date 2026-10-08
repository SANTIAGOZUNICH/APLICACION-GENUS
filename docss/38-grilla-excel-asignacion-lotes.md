# 38 — Grillas tipo Excel en GENUS OS (ETAPA 1: Asignación de Lotes)

Estado: **ETAPA 1 lista para validar — no mergeada.** Etapas 2–4 pendientes de validación.

## 1. Biblioteca elegida: `react-datasheet-grid` 4.11.6 (MIT)

| Alternativa | Licencia | Selección de rango por arrastre | Copiar/pegar Excel | React 19 | Veredicto |
|---|---|---|---|---|---|
| **react-datasheet-grid** | MIT | ✅ incluida | ✅ TSV Excel/Sheets | ✅ (peer `^19`) | **Elegida.** DOM + virtualización de filas/columnas, 312 KB, edición por celda, teclado completo, táctil nativo (tocar celda activa edita). |
| AG Grid Community | MIT | ❌ **Range Selection es Enterprise (pago)** | parcial | ✅ | Descartada: el requisito central (arrastrar rango) exige licencia comercial. |
| Glide Data Grid | MIT | ✅ | ✅ | ❌ peer `16–18` | Descartada: sin soporte React 19 (hay que forzar `--legacy-peer-deps`), render en canvas (peor accesibilidad/teclado móvil, difícil de testear). |
| TanStack Table | MIT | ❌ (headless) | ❌ | ✅ | Descartada: habría que construir el motor Excel a mano. |

Validado en navegador real (Chromium, desktop y móvil emulado) con 1.203 filas: 23 filas en el DOM, scroll < 1 s.

## 2. Componente reutilizable

`frontend/src/components/data-grid/`

- `genus-grid.tsx` — `<GenusGrid>`: motor + capa GENUS. Un adaptador por pantalla aporta `columns`, `onCommit`, permisos (`protection`), validación (`validate`) y `rowVersion`.
- `grid-changes.ts` — diff puro de filas → lista de **celdas** cambiadas (base del PATCH por celda).
- `genus-grid.css` — tema con tokens `--os-*`.

Capa GENUS sobre el motor: guardado por celda; estados `Guardando…` / `✓ Guardado` / `🔴 Error al guardar`; rollback al valor anterior si falla + Reintentar/Descartar; celdas protegidas (solo lectura + motivo); preview obligatorio para pegados masivos (> 5 celdas), borrados múltiples, columnas sensibles, celdas inválidas o protegidas; Deshacer (Ctrl+Z / botón) re-guardando el valor anterior; el check ✓ aparece **solo** tras la confirmación del servidor.

Adaptador de la Etapa 1: `operational/components/asignacion-lotes-grid.tsx`.

## 3. Guardado por celda (backend)

`PATCH /api/v1/asignacion-lotes/cells` — body `{ changes: [{ id, field, value, expectedVersion }] }`.

- Solo se escribe cada campo editado + `updated_at/updated_by`. **Nunca** se reenvía la fila completa.
- Atómico: se valida todo el lote (campo, permisos de sector, protección de origen, tipos, duplicados de identidad, versión); si una celda falla no se guarda ninguna y se devuelve `failures[]` por celda.
- Concurrencia optimista: `expectedVersion` = `updatedAt` visto por el cliente; el `UPDATE` incluye `date_trunc('milliseconds', updated_at) = $version` → `409 CONFLICT` si otro usuario/sync modificó el registro.
- Validación server-side: `lib/asignacion-lotes/cell-edit.ts` (compartido con el cliente, pero el servidor siempre revalida). Cantidades ≥ 0 (formato es-AR), fechas reales, lote/producto no vacíos, identidad `(lote, código, producto)` sin duplicar.
- Auditoría: tabla `asignacion_lotes_cell_audit` (migración **0039**, aditiva, sin gate): usuario, sector, registro, campo, valor anterior y nuevo, lote de operación. Se escribe **en la misma transacción** que el UPDATE.
- Persistencia real en Neon (`db.transaction`); en memoria solo sin `DATABASE_URL` (tests).

## 4. Política de edición para Asignación de Lotes (Google Sheets) — PROPUESTA IMPLEMENTADA

> Pedido: "Quiero que Claude proponga la política antes de programarla". Se implementó la opción **más conservadora (A)**, que no puede crear una segunda fuente de verdad oculta ni ser pisada en silencio. Las alternativas quedan listadas para que decidas antes de ampliar.

**Principio:** Google Sheets es la única fuente de verdad de los registros que sincroniza.

**Opción A (implementada) — Google = solo lectura en GENUS**
- Registro con `source_id != null` (sincronizado): **todas** las columnas de contenido son de solo lectura en la grilla (candado + tooltip *"Corregilo en la Sheet — el próximo sync pisaría cualquier cambio local"*). El servidor lo rechaza igual (`PROTECTED_SOURCE`, 403) aunque alguien llame a la API directo.
- Registro manual / "Pegar desde Excel" (`source_id = null`): editable por celda según la matriz de sectores. El sync **nunca** los toca (`upsertFromSource` solo opera dentro de su propia fuente; las colisiones de identidad se reportan como conflicto, no se fusionan). Cubierto por test.
- Sin escritura de vuelta a Google. Sin campo "override local". La columna **Origen** (`Manual` / `Google · <pestaña>`) es de solo lectura.

**Opción B (NO implementada) — corrección local temporal:** permitir editar filas de Google marcándolas "corregido localmente"; el sync las pisaría y avisaría. Requiere migración (flag + valor local vs. valor Google) y decisión tuya sobre quién puede hacerlo.
**Opción C (NO implementada) — escritura a Google con autorización:** requiere scope de escritura en la cuenta de servicio y flujo de aprobación.

## 5. Permisos por sector (Asignación de Lotes)

| Columna | Calidad | Producción | Codificado |
|---|---|---|---|
| Lote, Fecha, Producto, Código, Marca, Cantidades, VTO | ✏️ | ✏️ | 👁 |
| Muestras, CJ muestra, Fecha análisis | ✏️ | 👁 | 👁 |
| Observaciones | ✏️ | ✏️ | ✏️ |
| Origen (calculada) | 👁 | 👁 | 👁 |

Lote, Código y Producto (identidad/trazabilidad) son **columnas sensibles**: su edición siempre muestra confirmación. Otros sectores no acceden al módulo.
*Nota:* el modal "Editar" (formulario completo, preexistente) conserva su permiso de módulo (los 3 sectores). Queda fuera del alcance de la Etapa 1 y se puede alinear con esta matriz si lo confirmás.

## 6. Inventario de tablas y listados (auditoría)

Etapa 1 ✅ Asignación de Lotes.

| Etapa | Pantalla / archivo | ¿Grilla editable? | Notas |
|---|---|---|---|
| 1 | Asignación de Lotes (`asignacion-lotes-view.tsx`) | ✅ **hecha** | Google = solo lectura (§4) |
| 2 | Producción — operativo (`produccion-operational-view.tsx`), panel (`produccion-panel-view.tsx`) | Sí, campos de planificación | Respetar estados/aprobaciones |
| 2 | Pedidos (`production-pedidos-view.tsx`, `native-orders-list-view.tsx`) | Sí, cantidades/fechas/observaciones | Identidad del pedido protegida (migr. 0036) |
| 2 | Plan semanal (`shared-weekly-plan-view`, `semanas-produccion`, `work-item-progress-table.tsx`) | Sí, planificación | Origen Google (SEMANAS 2026): misma política que §4 |
| 3 | Depósito — graneles (`deposito-graneles-view.tsx`) | Sí, datos autorizados | Movimientos = ledger inmutable |
| 3 | Material de Empaque: ingresos/salidas/inventario/avisos (`me-*.tsx`) | Parcial | Ledger de stock inmutable: solo observaciones/datos maestros |
| 3 | Materias Primas: stock/hub (`materia-prima-stock-view.tsx`, `mp-hub-view.tsx`, `mp-stock-ledger-panel`, `mp-weekly-control-panel`) | Parcial | Idem ledger |
| 4 | Elaboración / Envasado / Codificado (`codificado-operational-view.tsx`, `work-item-progress-table`) | Sí, cantidades/observaciones propias | Sin saltear estados |
| 4 | Calidad (`calidad-operational-view.tsx`) | Campos propios de Calidad | Aprobaciones no editables por celda |
| — | OA/OE (`oa-form-sections`, `oe-form-sections`, `oa-simple-wizard`) | ❌ formularios legales | Trazabilidad/firmas: no se convierten |
| — | Entregados (`entregados-view.tsx`), Remitos (`remitos-view.tsx`), Historial (`historial-view.tsx`) | ❌ históricos inmutables | Solo lectura |
| — | Métricas, avisos, fórmulas (`metricas-view`, `me-avisos-view`, `formulas-admin-panel`) | ❌ / evaluar | Reportes y administración |
| — | Smart Paste (`smart-data-grid.tsx`) | — | Grilla de previsualización de importación (piloto previo); no editable |

## 7. Móvil

- Desktop: experiencia completa (arrastre de rango, atajos, copiar/pegar).
- Celular: tocar = seleccionar, tocar de nuevo la celda activa = editar, con teclado `decimal` para cantidades; sin necesidad de arrastrar. La grilla hace scroll horizontal **interno**; la página no tiene overflow (verificado a 390 px). Columna de acciones fija de 68 px.
- Botón **Ver como lista**: vuelve a la tabla/tarjetas anteriores (también requerido para "Seleccionar" + eliminar en lote).

## 8. Pruebas

- Unitarias/servicio/API (Vitest): `cell-edit.test.ts`, `asignacion-lotes-cells.test.ts`, `asignacion-lotes-cells-route.test.ts`, `grid-changes.test.ts`.
- Navegador real (Playwright/Chromium contra `next dev`, 1.203 filas): ver el informe del PR.

## 9. Observaciones fuera de alcance

- `POST /api/v1/asignacion-lotes` (preexistente) acepta `sourceId` en `record`; conviene ignorarlo salvo para el motor de sync.
- La caché local (`asignacion-lotes-repository.ts`) descartaba `sourceId`/`sourceSheetTab` y fabricaba `fecha = hoy` cuando venía vacía; se corrigió porque la grilla copia/muestra esos datos.
