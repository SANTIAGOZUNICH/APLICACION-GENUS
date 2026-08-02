# Matriz usuario × sector × permisos (Preview)

Fuente de verdad UI/RBAC: `src/lib/role-engine/sector-registry.ts` + directorio
`src/lib/auth/directory.ts`. La sesión cookie fija el sector; el cliente no puede elevarlo.

| Email (oculto) | Sector | Rol | Sidebar (ids) | Acciones permitidas (alta nivel) |
| --- | --- | --- | --- | --- |
| e***@… | ELABORACION | ROL-EL | mi_trabajo, ordenes_elaboracion, historial, avisos, procedimientos | Abrir/Crear OE, marcar iniciada/terminada, observaciones |
| e***@… | ENVASADO_MASIVO | ROL-OP | mi_trabajo, ordenes_acondicionamiento, historial, avisos, procedimientos, metricas | Crear/Abrir OA, entregar a Calidad, reportar problema, registrar avance |
| e***@… | ENVASADO_PREMIUM | ROL-OP | mi_trabajo, ordenes_acondicionamiento, historial, avisos, procedimientos, metricas | Crear/Abrir OA, entregar a Calidad, reportar problema |
| c***@… | CALIDAD | ROL-CA | pendientes, OE, OA, aprobados, rechazados, asignacion_lotes, avisos, procedimientos | Registrar resultado, aprobar/rechazar lote, solicitar liberación |
| p***@… | PRODUCCION | ROL-SU | panel general, OE, OA, asignar_trabajos, entregados, asignacion_lotes, ver_*, remitos, historial, avisos, procedimientos, metricas | Ver carga, resolver bloqueo, plan semanal, priorizar/asignar/reasignar |
| m***@… | MATERIA_PRIMA | ROL-OP | stock, mp_ingresos, control_mp, mp_compras, ordenes_elaboracion, historial, avisos, procedimientos | Registrar entrega MP, reportar faltante, consultar OE |
| c***@… | CODIFICADO | ROL-OP | mi_trabajo, OA, asignacion_lotes, consulta, plan_semanal, avisos, procedimientos | Marcar codificado, reportar problema, consultar lote, gestión asignación lotes |
| d***@… | DEPOSITO | ROL-OP | ingresos_me, salidas_me, inventario_me, deposito_graneles, avisos, semanas_produccion, procedimientos | Registrar preparados, reportar faltante, consultar pedido |

## Controles de seguridad verificados en Preview HTTP

| Ataque | Resultado |
| --- | --- |
| Header `x-genus-actor-email` forjado sin cookie | 401 |
| Cookie válida + `x-genus-actor-sector` ajeno | 403 |
| API sin sesión | 401 |
| Logout + reutilizar cookie | 401 |
| Password incorrecta / email inexistente | 401 genérico (mismo mensaje) |

## Separación crítica (no elevación)

- Producción **no** puede actuar como Calidad modificando headers/body.
- Calidad **no** hereda acciones exclusivas de MP (stock/ingresos MP) vía request.
- Cada login redirige al sector de la sesión (`/mi-trabajo` con home del Role Engine).
