# 29 — Estrategia de integración Sheets → Genus OS (24 meses)

> **Estado:** ACTIVA — reemplaza la visión “Apps Script como capa central” de `17-api.md` para la capa web.  
> **Horizonte:** 1–2 años · mantenible · sin backend nuevo · sin mover lógica a Apps Script.  
> **Fuente de verdad:** Google Sheets (igual que hoy en planta).

---

## 1. Decisión

Genus OS es una **capa web operativa** sobre las planillas existentes. No compite con AppSheet ni reemplaza el stack Sheets/AppSheet/Apps Script de producción.

```
Google Sheets (SEMANAS, PEDIDOS, ASIGNACION LOTES, …)
        ↓  lectura/escritura acotada
Next.js API routes + adapters (service account)
        ↓  JSON / WorkItems / KPIs
Genus OS (/mi-trabajo, vistas por sector/persona)
```

**Apps Script:** opcional y puntual — solo cuando una escritura no pueda hacerse bien desde Next.js (permisos, triggers de Sheets, side-effects en otras pestañas). **No** es el bus de datos ni el motor de reglas.

**Prohibido en este horizonte:**
- Backend propio (Postgres, Firebase, etc.)
- Mover mappers o reglas de negocio a Apps Script
- OAuth / auth real en Genus OS (sigue mock preview hasta decisión aparte)
- Rediseñar WorkspaceResolver, login, design system

---

## 2. Planillas y roles (24 meses)

| Planilla | Pestaña(s) | Rol en Genus OS | Estado código |
|----------|------------|-----------------|---------------|
| **SEMANAS 2026** | SEMANAS / PLAN | Plan semanal → `WorkItem` por sector/persona | ✅ Mapper F10.1 |
| **PEDIDOS 2026** | PEDIDOS | Referencias pedido/cliente | ⚠️ Lectura parcial (`pedido.mapper`) |
| **PEDIDOS 2026** | **DASHBOARD** | KPIs planta / Producción | ❌ Pendiente |
| **ASIGNACION LOTES 2026** | ASIGNACION | Calidad / lotes pendientes | ❌ Mapper F8.2 |
| Otras (OE, OA, MP…) | — | Fase 2+ vía Drive index | Fuera de slice actual |

---

## 3. Prioridades (orden de ejecución)

### P1 — Lectura real de Sheets ✅ en curso

**Objetivo:** `/mi-trabajo` y `/api/v1/work-items` muestran datos de SEMANAS en Vercel con `GENUS_DATA_MODE=real`.

**Ya existe:**
- `operationsDocumentRepository` — index Drive desde `GOOGLE_DRIVE_GENUS_FOLDER_ID`
- `sheetsReader` — meta + rangos + merges
- `semanas-to-work-items.ts` — bloques visuales → `WorkItem`
- `GET /api/v1/work-items`, `/drive/health`, `/drive/refresh`
- UI operativa con fallback demo (`operational-sheets-adapter`)

**Falta operativo (no código nuevo de arquitectura):**
- Vercel: env vars + `Root Directory = frontend`
- Post-deploy: `GET /api/v1/drive/refresh?scope=all` antes de usar work-items
- Sincronizar `GENUS_DATA_MODE` y `NEXT_PUBLIC_GENUS_DATA_MODE`

**Criterio de done P1:** Producción en Vercel devuelve WorkItems reales para al menos Envasado + Elaboración.

---

### P2 — Escritura simple hacia Sheets

**Objetivo:** acciones como aprobar/rechazar (Calidad) persisten en la planilla, no solo en `localStorage`.

**Camino preferido (Next.js):**
- Ampliar scope SA de `spreadsheets.readonly` → `spreadsheets` (solo en rutas de escritura)
- `SheetsWriter` mínimo: `appendRow` / `updateRange` en celdas acordadas
- `POST /api/v1/quality/decisions` (ejemplo) — validación server-side, append-only donde aplique GMP

**Cuándo Apps Script (opcional):**
- La escritura debe disparar lógica ya existente en Script (notificar Slack, recalcular otra pestaña)
- La SA no puede tener Editor en esa hoja por política GMP
- Trigger `onEdit` en Sheets debe seguir siendo la “posta”

**Regla:** una acción = un rango conocido + contrato documentado. Sin motor de reglas en Script para Genus OS.

**Criterio de done P2:** Aprobar en Calidad se refleja en Sheets y en Producción > Aprobados tras refetch.

---

### P3 — Polling / refetch confiable

**Objetivo:** la web refleja cambios en Sheets sin realtime caro.

**Ya existe:**
- `useOperationalPlan` — polling 30s + botón Refrescar
- `serverCache` TTL configurable (`GENUS_DRIVE_CACHE_TTL_SECONDS`)

**Mejoras incrementales (sin infra nueva):**
| Mejora | Esfuerzo | Notas |
|--------|----------|-------|
| Invalidar cache server al refetch manual | Bajo | Query param `?fresh=1` en API |
| Vercel Cron → `/api/v1/drive/refresh` cada N min | Bajo | Pre-calienta índice; reduce cold starts |
| ETag / `scannedAt` en UI | Bajo | Ya parcialmente visible |
| Redis/KV | **Posponer** | Solo si cron + TTL no alcanzan |

**Default recomendado:** polling cliente 30–60s + cron server cada 5–10 min + Refrescar manual.

---

### P4 — KPIs desde DASHBOARD (PEDIDOS 2026)

**Objetivo:** pestaña Producción > KPIs lee la pestaña **DASHBOARD** real, no agregados calculados solo desde WorkItems.

**Entregables:**
1. **Discovery** — una pasada sobre DASHBOARD real (columnas, filas, merges) → fixture en `__fixtures__/`
2. `pedidos-dashboard.mapper.ts` — filas → `DashboardKpiSnapshot`
3. `GET /api/v1/kpis/dashboard` — o extender preview de PRODUCCION
4. UI: reemplazar cards mock en `ProduccionOperationalView` tab KPIs

**Env:** `SHEETS_TAB_DASHBOARD=DASHBOARD` (default)

**Principio:** KPIs = lo que ya calcula planta en Sheets. Genus OS **muestra**, no recalcula fórmulas complejas.

---

### P5 — Vistas filtradas sector / persona

**Objetivo:** cada operario ve solo su bloque (ya iniciado en PR #47).

**Ya existe:**
- Filtro `ownerPerson` en API + mapper SEMANAS (bloques Cristian / Nicolás)
- Filtro `sector` en `filterWorkItemsForSectorAndPerson`
- UI operativa por sector

**Completar:**
- ASIGNACION LOTES → ítems Calidad reales (F8.2)
- PEDIDOS refs en tablas envasado/elaboración donde falte `pedidoRef`
- Usuarios mock → auth real (fuera de este doc; no bloqueante para datos)

---

## 4. Roadmap sugerido (24 meses, por trimestres)

| Trimestre | Entrega | PRs chicos |
|-----------|---------|------------|
| **T1** | P1 en Vercel + SEMANAS estable | env, health, refresh, smoke tests |
| **T2** | P4 DASHBOARD + P3 cron/cache | mapper dashboard, KPI tab real |
| **T3** | F8.2 ASIGNACION LOTES + Calidad lectura | quality items desde Sheets |
| **T4** | P2 escrituras Calidad (Next o Script puntual) | POST decision + refetch |
| **T5–T8** | PEDIDOS enriquecido, Depósito, más sectores | un mapper / sector por PR |

No planificar microservicios, colas ni sync bidireccional complejo.

---

## 5. Contratos API (mantener / agregar)

### Lectura (existente)

```
GET /api/v1/drive/health
GET /api/v1/drive/refresh?scope=all|pcp|lotes|critical_sheets
GET /api/v1/work-items?sector=ENVASADO_MASIVO&ownerPerson=Cristian
GET /api/v1/work-items/preview?sector=PRODUCCION
GET /api/v1/lotes
GET /api/v1/pedidos
```

### Lectura (agregar)

```
GET /api/v1/kpis/dashboard          ← PEDIDOS 2026 / DASHBOARD
```

### Escritura (agregar — P2)

```
POST /api/v1/quality/decisions    ← { itemId, action: approve|reject, … }
```

Todas las rutas siguen en `app/api/v1/*`. Sin servicio aparte.

---

## 6. Variables de entorno (mínimo 24 meses)

```env
# Modo
GENUS_DATA_MODE=real
NEXT_PUBLIC_GENUS_DATA_MODE=real
GENUS_FALLBACK_TO_DEMO=true

# Google (server only)
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
GOOGLE_DRIVE_GENUS_FOLDER_ID=

# Fast path opcional
GOOGLE_SHEETS_SEMANAS_2026_ID=
GOOGLE_SHEETS_PEDIDOS_2026_ID=
GOOGLE_SHEETS_ASIGNACION_LOTES_2026_ID=

# Pestañas
SHEETS_TAB_SEMANAS=SEMANAS
SHEETS_TAB_PEDIDOS=PEDIDOS
SHEETS_TAB_DASHBOARD=DASHBOARD
SHEETS_TAB_ASIGNACION_LOTES=ASIGNACION

# Cache / polling
GENUS_DRIVE_CACHE_TTL_SECONDS=600
# NEXT_PUBLIC_OPERATIONAL_POLL_MS=30000  ← futuro, client
```

**Escritura:** cuando P2 esté activo, la SA necesita **Editor** en rangos de escritura acordados (no readonly).

---

## 7. Apps Script — alcance permitido

| Usar Script | No usar Script |
|-------------|----------------|
| Webhook POST después de acción Genus OS | Leer SEMANAS para Genus OS |
| Trigger que mantiene lógica legacy | Mappers WorkItem |
| Escritura en hoja sin permiso SA | Auth / sesiones |
| Notificación Slack existente | KPIs (leer DASHBOARD directo) |

Si Script expone URL: Genus OS la llama desde **una** route Next.js; el front nunca ve la URL.

---

## 8. Riesgos conocidos (sin solución big-bang)

| Riesgo | Mitigación 24m |
|--------|----------------|
| Cold start Vercel borra cache | Cron refresh |
| Planillas irregulares | `pickField` + fixtures reales (patrón SEMANAS) |
| Demo/real desincronizados | Misma env en server + client |
| Escritura GMP | Append-only + auditoría en columna usuario/fecha |
| AppSheet y Genus OS escriben lo mismo | Acordar rangos exclusivos por sistema |

---

## 9. Relación con otros docs

| Doc | Relación |
|-----|----------|
| `16-backend.md` | Sheets sigue siendo verdad; AppSheet no se toca |
| `17-api.md` | Visión largo plazo; **esta doc manda** para 24m web |
| `28-convergence-strategy.md` | Strangler Fig UI; compatible |
| PR #47 `/mi-trabajo` operativo | Capa presentación sobre adapters |

---

## 10. Próximo paso concreto

1. Conectar Vercel + env vars P1  
2. Smoke: `health` → `refresh` → `work-items?sector=ENVASADO_MASIVO`  
3. Abrir PR **solo discovery DASHBOARD**: export/fixture + propuesta columnas KPI  
4. No implementar P2 escritura hasta tener fixture ASIGNACION LOTES o contrato de columnas Calidad  

**Definition of success (12 meses):** operarios usan `/mi-trabajo` diario con SEMANAS real, KPIs desde DASHBOARD, y al menos una acción de Calidad persistida en Sheets.
