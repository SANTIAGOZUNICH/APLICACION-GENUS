# Transferencia Neon — auditoría y mitigaciones

**Fecha:** 2026-07-29 · Rama `claude/genus-os-operational-ui` · PR #60

## Causa del 402

Neon Preview superó **data transfer quota**. El patrón dominante era
**SELECT * de dominio completo → filtrar en JS**, multiplicado por
**cold starts serverless** y **polling agresivo**.

## Mitigaciones aplicadas (seguridad de frescura)

1. Work-items: filtros SQL + poll **20s** + pause oculta + **refresh al visible** + botón **Actualizar**.
2. Notificaciones: 1 GET `?all=1`, sector SQL + `LIMIT 200`, poll **45s** + visible + pull al abrir campana.
3. Live-sync: base **8s**, backoff hasta **60s** (ya con visibility).
4. Inventory MP: **dedupe in-flight** (sin TTL temporal — evita split-brain Stock).
5. Fórmulas: caché filas **10 min** solo catálogo read-only; invalidate en persist/import.
6. Remitos: `findById` puntual + list `LIMIT 500` — **sin caché de listado**.
7. Órdenes: WHERE SQL + hard cap 2000.
8. MP ledger: `LIKE prefix%`.

## Claves de caché (aislamiento)

| Clave | Contenido | Riesgo multi-usuario |
|-------|-----------|----------------------|
| `formula:bank:rows` | Catálogo fórmulas (no sectorial) | Bajo — read-only compartido; no PII de trabajo |
| *(ninguna)* remitos list | — | Listado siempre fresco |
| *(ninguna)* notifications | Filtrado por `sector` + `actorEmail` en cada request | OK |
| work-items | SQL por sector/date | OK — sin caché de proceso |

## Estimación (1 sesión / 1 h)

| | Antes | Después |
|--|-------|---------|
| Poll work-items | ~720 | ~180 (−75%) |
| Notificaciones | ~240 dumps | ~80 (−67%) |
| Live-sync | ~1200 | ~450 (−62%) |
| **UI/runtime** | — | **≈ −55–70%** |

## Demoras visuales esperadas

| Evento | Peor caso sin acción | Mitigación |
|--------|----------------------|------------|
| Trabajo asignado | hasta **20s** | Actualizar / volver a pestaña |
| Envío a Codificado | hasta **20s** en otra sesión | idem |
| Notificación nueva | hasta **45s** | abrir campana / visible |
| Remito / MP Stock | inmediato (sin list-cache) | — |
| Aprobación Calidad | SSE ops + Actualizar | — |

## Fórmulas 842/784

No se reimportan ni modifican. Solo se reduce frecuencia de lectura.
