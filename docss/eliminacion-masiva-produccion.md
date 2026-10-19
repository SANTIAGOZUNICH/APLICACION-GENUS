# Selección múltiple y eliminación masiva (Producción)

## Dónde está disponible
- **Pendientes de definir** (Producción): checkbox por fila + encabezado, barra «X registros seleccionados», «Eliminar seleccionados (X)», modal de confirmación.

## Componentes reutilizables
`frontend/src/features/os/operational/components/bulk-select/`:
`useBulkSelection` (el alcance es siempre la vista actual: lo que deja de estar visible se descarta de la selección),
`BulkSelectCheckbox`, `BulkSelectionBar`, `BulkDeleteDialog`, `useBulkDeleteWorks` (dry-run → confirmar).

## Servidor
`POST /api/v1/work-items/bulk-delete` — solo sector PRODUCCION (misma regla que el borrado individual, validada con la sesión).
`dryRun: true` devuelve veredictos sin escribir. Una sola transacción, filas bloqueadas, idempotente por `batchKey`.

Reglas (reutilizan el borrado individual: eliminación LÓGICA, motivo obligatorio, versión+1, evento
`WORK_ITEM_DELETED_BY_PRODUCCION` por trabajo) más protección del historial. No se eliminan: trabajos entregados, con
entregas registradas o incluidos en un remito. No toca stock, movimientos ni consumos de MP; no hay cascada (la fila nunca se borra).
Auditoría del lote en `feature_audit_events` (`work_items` / `BULK_DELETE`).

## Tablas que NO usan este componente (todavía)
- Pedidos de producción, listado de OE nativas, Entregados, Asignación de lotes y Hub de MP ya tienen selección múltiple con el kit anterior (`list-selection-mode`, modo «Seleccionar»), con borrado por registro.
- Remitos: solo los borradores se pueden eliminar; pendiente de migrar al kit nuevo.
- Entregas/Portal de Clientes (en pausa), Historial, Métricas, Procedimientos, Avisos: son registros de auditoría/solo lectura.

## Corrección visual y acciones masivas (PR siguiente al #152)
- Causa del fondo claro: el kit usaba variables CSS inexistentes (`--genus-primary`, `--genus-primary-soft`) y caía al color de respaldo verde claro. Ahora usa `#12bfb7` translúcido (12 %) + borde lateral de 3 px en la primera celda; no cambia alto ni distribución.
- Barra: «Marcar como entregados (X)», «Enviar a Codificado (X)», «Eliminar seleccionados (X)», «Deseleccionar» (se acomoda en dos líneas en tablets angostas).
- `POST /api/v1/work-items/bulk-action` (Producción y Dirección): reutiliza `recordDeliveryInTx` (= «Registrar entrega», entrega TODO el saldo) y `handoffToCodificadoInTx` (= cuerpo de «Enviar a Codificado»). Una transacción; un SAVEPOINT por trabajo (un rechazo de negocio deja ESE trabajo intacto y lo informa; un error inesperado revierte todo). La vista previa ejecuta el flujo real y lo revierte. Idempotente por `batchKey`. Auditoría `BULK_DELIVER` / `BULK_SEND_CODIFICADO`.
- Elegibilidad: el trabajo debe seguir «pendiente de definir» y la acción debe estar entre las que su sector permite (`classifyPendingDefinition`); el resto de reglas son las del flujo individual (entregado, cancelado, cantidad, estado, sector de origen…).
- No atómico por diseño: entregar/enviar notifica FUERA de la transacción (igual que el flujo individual); un fallo de aviso nunca revierte la operación.
