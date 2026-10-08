# 41 — Grillas tipo Excel: estado por módulo

Motor único: `GenusGrid` (react-datasheet-grid). Estándar: selección de celda/rango con mouse, Ctrl+C a Excel/Sheets, Ctrl+V, flechas/Tab/Enter, doble clic para editar, Supr, Deshacer, estados Guardando/Guardado/Error, rollback, preview de operaciones masivas, celdas protegidas con candado y motivo, guardado **solo de celdas modificadas**. El usuario puede volver a la lista con «Ver como lista» (preferencia recordada).

**Cómo se aplica a todas las tablas:** `OperationalTable` (usada por ~25 tablas en 14 vistas) muestra por defecto la planilla (solo lectura salvo columnas con `edit`); `ExcelOrList` hace lo mismo para listados con marcado propio. No hay una grilla distinta por sector.

| Módulo / pantalla | Planilla (seleccionar + copiar rangos) | Edición por celda | Estado |
|---|---|---|---|
| Asignación de Lotes | ✅ | ✅ (manual + Google opción C, con permisos por sector) | probado E2E local + simulado Google |
| Producción → Semanas (ELABORACION, ACONDICIONAMIENTO, C/DIA, ENTREGAS) | ✅ | ✅ (Sheet = fuente de verdad, write-back a copia de prueba) | probado E2E sobre copia local del libro |
| Pedidos (Producción) | ✅ | ✅ op, fecha, OC, cliente, producto, S, Q, ML (KG derivado y ESTADO protegidos; ENTREGADO cerrado) | probado E2E local, PATCH parcial + conflicto |
| Elaboración / Envasado Masivo / Envasado Premium / Pendientes (`WorkItemProgressTable`) | ✅ | ❌ solo lectura (el avance se registra por el drawer: estados/aprobaciones) | código listo, sin datos demo para E2E |
| Codificado | ✅ | ❌ | idem |
| Calidad (pendientes / aprobados / rechazados) | ✅ | ❌ (decisiones = aprobaciones) | verificado en navegador |
| Depósito Graneles | ✅ | ❌ (pendiente: campos autorizados) | código listo |
| Material de Empaque: ingresos / salidas / inventario / avisos | ✅ (OperationalTable) | ❌ (ledger de stock inmutable) | código listo |
| Materias Primas: stock / hub / ledger / compras | ✅ | ❌ (ledger inmutable) | código listo |
| Entregados / Historial / Remitos / Métricas | ✅ | ❌ (históricos/legales inmutables) | código listo |
| Órdenes de Elaboración (listado) | ✅ | ❌ (formularios legales OA/OE) | código listo |
| Control semanal MP (líneas con inputs) | ❌ | ya editable con sus propios inputs | pendiente de migrar |
| Plan semanal (vista calendario de work-items) | ❌ | — | pendiente |
| Fórmulas (admin) | ✅ (OperationalTable) | ❌ | código listo |

**Pendiente de implementación (honesto):** edición por celda en Depósito, MP, ME inventario (campos maestros), Producción operativo/panel (cantidades/fechas planificadas), Plan semanal y Control semanal MP; requiere PATCH parcial por dominio con sus reglas de estado/aprobación (el patrón está en `production-pedidos/cell-edit.ts` + `patchCells`).
