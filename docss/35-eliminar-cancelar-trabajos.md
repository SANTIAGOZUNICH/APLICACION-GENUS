# Genus OS — Eliminar / cancelar trabajos (Producción)

**Rama:** `claude/genus-os-operational-ui`  
**Estado:** Beta Preview

## Reglas

| Situación | Acción |
|---|---|
| Pendiente sin avance | **Eliminar** (baja lógica `meta.deleted`) |
| En curso / con avance / enviado a Calidad | **Cancelar** con motivo obligatorio → `status: cancelado` |
| Finalizado (`completo`) | No eliminar; opción **Archivar** |

Solo `actorSectorId === PRODUCCION`. Ausente/inválido → 403.

## Efectos

- Desaparece de bandejas activas (`mergeManualWorkItems` / listados).
- No toca documentos OE/OA ni decisiones de Calidad.
- Cancelados aparecen en Historial (Producción).
- Live Sync: `POST /api/v1/live-sync/operations` action `cancel_work` (requiere modo real).

## Limitación

`actorSectorId` no es autenticación server-side. Un cliente podría falsificarlo hasta Identity Access real.
