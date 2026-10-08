# 41 — Grillas tipo Excel: estado por módulo

Motor único: `GenusGrid` (react-datasheet-grid). Estándar: selección de celda/rango con mouse, Ctrl+C a Excel/Sheets, Ctrl+V, flechas/Tab/Enter, doble clic para editar, Supr, Deshacer, estados Guardando/Guardado/Error, rollback, preview de operaciones masivas, celdas protegidas con candado y motivo, guardado **solo de celdas modificadas**. El usuario puede volver a la lista con «Ver como lista» (preferencia recordada).

**Cómo se aplica a todas las tablas:** `OperationalTable` (usada por ~25 tablas en 14 vistas) muestra por defecto la planilla (solo lectura salvo columnas con `edit`); `ExcelOrList` hace lo mismo para listados con marcado propio. No hay una grilla distinta por sector.

| Módulo / pantalla | Planilla (seleccionar + copiar rangos) | Edición por celda | Estado |
|---|---|---|---|
| Asignación de Lotes | ✅ | ✅ (manual + Google opción C, con permisos por sector) | probado E2E local + simulado Google |
| Producción → Semanas: ELABORACION y ACONDICIONAMIENTO | ✅ **Calendario operativo** (tarjetas + prioridades + Modo TV), **Planilla** con celdas combinadas reales, colores/anchos/semanas plegadas de la Sheet, y «Ver como lista» | ✅ (Sheet = fuente de verdad, write-back solo a copia de prueba) | unitarias + E2E visual Chromium (escritorio y móvil) sobre copia local |
| Producción → Semanas: C/DIA y ENTREGAS | ✅ GenusGrid (son tablas planas) | ✅ | probado E2E sobre copia local del libro |
| Pedidos (Producción) | ✅ | ✅ op, fecha, OC, cliente, producto, S, Q, ML (KG derivado y ESTADO protegidos; ENTREGADO cerrado) | probado E2E local, PATCH parcial + conflicto |
| Elaboración / Envasado Masivo / Envasado Premium / Pendientes (`WorkItemProgressTable`) | ✅ | ✅ planificación (fecha, entrega, cliente, producto, cantidad, unidad, observación, lote/VTO con motivo) vía `PATCH /api/v1/work-items/cells`; avance/estado siguen por el drawer | unitarias de política + servicio |
| Codificado | ✅ | ❌ | idem |
| Calidad (pendientes / aprobados / rechazados) | ✅ | ❌ (decisiones = aprobaciones) | verificado en navegador |
| Producción operativo / Panel de Producción | ✅ | ✅ mismos campos de trabajo (solo sector Producción, trabajos nativos no cerrados) | unitarias |
| Plan semanal (detalle del día) | ✅ | ✅ mismos campos de trabajo; calendario L–V sin cambios | E2E local 16/16 (`npm run test:e2e:plan-semanal`, Postgres descartable) |
| Depósito Graneles | ✅ | ✅ `PATCH /api/v1/deposito-graneles/cells` (kg con motivo y delta auditado; registros de Envasado/anulados/archivados protegidos) | unitarias de servicio |
| Material de Empaque: ingresos / salidas / inventario / avisos | ✅ (OperationalTable) | ✅ inventario: campos maestros (`PATCH /api/v1/inventory/cells`); stock derivado y ledgers inmutables | unitarias |
| Materias Primas: stock / hub / ledger / compras | ✅ | ✅ stock: kg por `adjustMpStock` con motivo; lotes de ingreso y ledger inmutables | unitarias |
| Entregados / Historial / Remitos / Métricas | ✅ | ❌ (históricos/legales inmutables) | código listo |
| Órdenes de Elaboración (listado) | ✅ | ❌ (formularios legales OA/OE) | código listo |
| Control semanal MP | ✅ | ✅ `PATCH /api/v1/mp-control/[id]/cells` (kg, lote, preparado, observación; solo BORRADOR, todo-o-nada) | unitarias de servicio |
| Fórmulas (admin) | ✅ (OperationalTable) | ❌ | código listo |

**Pendiente (honesto):** Codificado, Calidad, Entregados/Historial/Remitos y Órdenes de Elaboración quedan **solo lectura a propósito** (decisiones, firmas e históricos legales no se editan por celda). Ninguna edición por celda fue probada todavía contra Neon/Google reales: todo lo marcado como «unitarias» corre sobre servicios en modo memoria. Trabajos de la planilla Google (no nativos) se editan solo desde Producción → Semanas.
