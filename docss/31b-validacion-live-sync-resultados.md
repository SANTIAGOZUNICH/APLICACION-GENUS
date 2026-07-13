# 31b — Resultados validación Live Sync (PR #53)

> **Fecha:** 2026-07-13 14:35 UTC  
> **Preview:** https://aplicacion-genus-git-cursor-l-9f5595-santizunich-2879s-projects.vercel.app  
> **Branch:** `cursor/live-sync-engine-3d8a`  
> **Commit:** pendiente push (fix `primarySource` + auditoría script)

---

## Veredicto gate

| Criterio | Resultado |
|----------|-----------|
| 1. Sheets → Genus OS sin F5 | **NO EVALUADO** — bypass vacío |
| 2. Genus OS → otros sectores sin F5 | **NO EVALUADO** — bypass vacío |
| 3. Datos reales visibles | **NO EVALUADO** |
| 4. Sin duplicados ni retrocesos | **NO EVALUADO** |
| 5. Experiencia suficientemente rápida | **NO EVALUADO** |

### Gate PR #53: **FAIL** (bloqueo de acceso al preview)

**Causa confirmada:** `VERCEL_AUTOMATION_BYPASS_SECRET` está **presente pero vacío** (`len=0`) en el entorno del Cloud Agent.  
`GET /api/v1/env-check` → **HTTP 401** sin header de bypass.

**Acción requerida:** Re-guardar el secret en Cursor Cloud Agent Secrets y **reiniciar el agente** (los secrets no se inyectan en caliente si la variable ya existía vacía).

**No se implementó Redis/KV/webhooks** — conforme instrucción.

---

## Lo que sí pasó en esta ejecución

| Check | Resultado |
|-------|-----------|
| Tests unitarios | **89 passing** (+1 test projector) |
| Build | OK (previo) |
| Preview acceso | **FAIL** HTTP 401 |
| Fix código | `primarySource` lotes-only → `asignacion_lotes_2026` |
| Script auditoría | Ampliado en `validate-live-sync-operativa.mjs` |

---

## Bug funcional corregido (sin preview)

| Problema | Fix |
|----------|-----|
| WorkItems creados solo desde ASIGNACIÓN DE LOTES se etiquetaban `source=semanas_2026` | `work-item-projector.ts` — `primarySource()` ahora retorna `asignacion_lotes_2026` cuando corresponde |

Esto afectaba la auditoría SEMANAS-first y la trazabilidad en Calidad.

---

## Flujo A — instrucciones manuales (estructura SEMANAS 2026)

Cuando el bypass funcione, el script imprimirá celdas exactas desde `sourceRange` de WorkItems reales.  
Mientras tanto, usar esta geometría (parser columnar):

### Envasado Masivo (Francisco)

| Campo | Valor |
|-------|-------|
| **Archivo** | `SEMANAS 2026` (Google Drive — carpeta operativa Genus) |
| **Pestaña** | `ACONDICIONAMIENTO` |
| **Bloque** | Fila con texto `ENVASADO CONSUMO MASIVO` + `LÍNEA 1` (o Línea 2/3/4) |
| **Celda a editar** | Columna del día (Lunes–Viernes), **fila de cantidad** debajo del producto |
| **Ejemplo fixture** | Miércoles, producto CAV SHAMPOO → cantidad `6400` → cambiar a `6401` o agregar marker `GENUS-TEST-HHMM` |

### Envasado Premium (Belén / Francisco Premium)

| Campo | Valor |
|-------|-------|
| **Archivo** | `SEMANAS 2026` |
| **Pestaña** | `ACONDICIONAMIENTO` |
| **Bloque** | Fila `ENVASADO PRODUCTOS PREMIUN` + `LÍNEA 2` |
| **Celda** | Cantidad planificada del producto visible en Genus OS (ej. MILKY TONER `900 x100ml`) |

### Elaboración (Cristian / Nicolás)

| Campo | Valor |
|-------|-------|
| **Archivo** | `SEMANAS 2026` |
| **Pestaña** | `ELABORACION` |
| **Bloque** | Fila con solo `CRISTIAN` o `NICOLAS` |
| **Celda** | Columna del día, cantidad KG (ej. `55KG` → `56KG`) |

### Protocolo de medición Flujo A

1. Terminal: `export VALIDATION_MARKER="GENUS-TEST-$(date +%H%M)" && node frontend/scripts/validate-live-sync-operativa.mjs --flow-a`
2. Anotar hora exacta al guardar celda en Sheets
3. El script poll cada 500 ms hasta 30 s
4. Verificar en paralelo (sin F5): Francisco, Agustina Producción, Dirección

**Objetivo latencia:** 2–5 s (poll `modifiedTime` cada 4 s + SSE `snapshot.updated`)

---

## Flujo B — protocolo (cuando bypass OK)

```bash
export BASE_URL="https://aplicacion-genus-git-cursor-l-9f5595-santizunich-2879s-projects.vercel.app"
# VERCEL_AUTOMATION_BYPASS_SECRET inyectado por Cloud Agent — no exportar manualmente
node frontend/scripts/validate-live-sync-operativa.mjs
```

Casos automatizados:
1. Francisco `Terminadas=300` → Agustina + Dirección (< 1 s)
2. Francisco `Entregar a Calidad` → Santiago + Producción + Dirección
3. Santiago `Aprobar` → Producción + Dirección

Validación visual manual: 4 browsers en `/mi-trabajo` con logins del doc `31-validacion-live-sync-operativa.md`.

---

## Auditoría funcional (script — pendiente datos reales)

El script verifica automáticamente:

| Check | Qué detecta |
|-------|-------------|
| SEMANAS-first | Masivo/Premium/Elaboración sin `semanas_2026` en `createdFrom` |
| duplicados | IDs de WorkItem repetidos |
| líneas envasado | Órdenes Masivo/Premium sin `line` |
| responsables elaboración | Items ELABORACION sin `ownerPerson` |
| index sheets | SEMANAS / PEDIDOS / LOTES indexados en Drive |
| conteos sector | Masivo, Premium, Elab, Producción agregada, Calidad |

---

## Tabla final de validación (ejecución 2026-07-13 14:30 UTC)

| Flujo | Usuario | Dato | Origen | Destino | Latencia | PASS/FAIL | Observaciones |
|-------|---------|------|--------|---------|----------|-----------|---------------|
| ACCESO | — | env-check | Preview | API | 74ms | **FAIL** | HTTP 401 — bypass len=0 |
| AUDIT | — | todos | — | — | — | **SKIP** | Requiere bypass |
| A | todos | SEMANAS | Sheets | Genus OS | — | **SKIP** | `--flow-a` + bypass |
| B1–B3 | Francisco→Santiago | operaciones | Genus OS | sectores | — | **SKIP** | API inaccesible |
| CARGA | 4 usuarios | cold/warm | API | sectores | — | **SKIP** | Idem |
| SSE | 4 usuarios | stream | live-sync | clientes | — | **SKIP** | Idem |

---

## Qué funciona (código + CI)

1. Live Sync Engine: snapshot caliente, poll 4 s, SSE, overlay operativo server-side
2. PEDIDOS: `createIfMissing: false` — no crea trabajos operativos
3. SEMANAS: parser columnar con líneas, ramas Cristian/Nicolás, sectores Masivo/Premium
4. Propagación cross-sector: `operationalOverlay` + `mergeFromServer` + columna Terminadas
5. 89 tests unitarios passing

## Qué no funciona (confirmado)

1. **Acceso al preview desde Cloud Agent** — secret vacío → HTTP 401
2. **Validación end-to-end con datos reales** — bloqueada por (1)

## Qué falta corregir

1. **Inyección del bypass secret** en Cloud Agent (bloqueante para gate)
2. Validar multi-instancia Vercel (2 browsers distintos) — documentar si falla propagación cross-lambda
3. Ejecutar auditoría con datos reales post-bypass

## Problemas reales de arquitectura (conocidos, no bloqueantes aún)

| Riesgo | Detalle |
|--------|---------|
| Estado in-memory | `ServerOperationalState` por instancia lambda — propagación cross-usuario puede fallar si SSE y POST caen en instancias distintas |
| Poll Sheets | 4 s mínimo — no instantáneo como webhook |
| Dependencias sectoriales | No inferidas aún (doc 22 §4.6) — `dependsOn` null |

## Qué hacer mañana (UX, con motor sólido)

1. Completar gate PR #53 con bypass OK
2. Pulir indicador **Actualizado hace Xs** / **En vivo** (sin botón Refrescar)
3. Feedback visual en Guardar avance / Entregar / Aprobar (< 1 s percibido)
4. Empty states por sector cuando SEMANAS no tiene bloque del día
5. NO agregar Redis/KV hasta evidencia de fallo multi-instancia

---

## Comando único post-bypass

```bash
node frontend/scripts/validate-live-sync-operativa.mjs        # B + carga + SSE + auditoría
node frontend/scripts/validate-live-sync-operativa.mjs --flow-a  # mientras editás SEMANAS
```
