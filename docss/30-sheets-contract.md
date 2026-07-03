# 30 — Contrato de Sheets (Genus OS ↔ Google Sheets)

> **Estado:** BORRADOR PARA APROBACIÓN — referencia oficial entre planillas y Genus OS  
> **Versión:** 0.1 · 2026-07-03  
> **Precede a:** discovery completo de pestaña DASHBOARD y mapper de KPIs reales  
> **Estrategia vinculante:** `29-sheets-integration-strategy.md`

---

## 1. Propósito

Este documento define el **contrato de datos** entre Google Sheets (fuente de verdad) y Genus OS (capa web operativa). Todo mapper, adapter, ruta API y vista debe alinearse a este contrato.

**Principios inviolables:**

1. **Google Sheets es la fuente de verdad** — Genus OS no sustituye fórmulas, tablas ni reglas ya existentes en planta.
2. **No mover lógica a Apps Script** — la lectura/escritura acotada vive en Next.js (service account). Apps Script solo para side-effects puntuales acordados (P2).
3. **Mostrar, no recalcular** — KPIs y agregados que ya existen en Sheets se **leen y muestran**; Next.js no replica fórmulas de planta.
4. **Irregularidad admitida** — columnas se resuelven por alias (`pickField`); el contrato documenta intención, no exige normalización previa del Excel.
5. **Alcance 24 meses** — solo las hojas listadas en §3; el resto del Drive queda fuera de slice hasta nueva versión del contrato.

---

## 2. Resumen ejecutivo

| Planilla | Pestaña(s) | Modo Genus OS | Módulo(s) | Estado mapper |
|----------|------------|---------------|-----------|---------------|
| **SEMANAS 2026** | `SEMANAS` / `PLAN` | Solo lectura | `/mi-trabajo` operativo, `/plan-semanal`, API work-items | ✅ F10.1 |
| **PEDIDOS 2026** | `PEDIDOS` | Solo lectura | refs pedido, `/pedido/[id]`, enriquecimiento tablas | ⚠️ Parcial |
| **PEDIDOS 2026** | `DASHBOARD` | Solo lectura | Producción → tab KPIs, Dirección (futuro) | ❌ Pendiente discovery |
| **ASIGNACION DE LOTES 2026** | `ASIGNACION` / mensual | Solo lectura (P2 TBD) | Calidad, `/lote/[id]` | ⚠️ Parcial (F8.2) |

**Escritura hacia Sheets:** ninguna en producción hoy. Calidad approve/reject persiste en `localStorage` hasta P2. Rangos de escritura futuros están definidos como **propuesta** en §8.

---

## 3. Planillas que consume Genus OS

### 3.1 Hojas en scope (slice actual)

| ID interno | Archivo en Drive | Carpeta esperada | Env fast-path | Env pestaña |
|------------|------------------|------------------|---------------|-------------|
| `semanas_2026` | `SEMANAS 2026` | `PRODUCCION 2026/PCP` | `GOOGLE_SHEETS_SEMANAS_2026_ID` | `SHEETS_TAB_SEMANAS` (default `SEMANAS`, fallback `PLAN`) |
| `pedidos_2026` | `PEDIDOS 2026` | `PRODUCCION 2026/PCP` | `GOOGLE_SHEETS_PEDIDOS_2026_ID` | `SHEETS_TAB_PEDIDOS` (default `PEDIDOS`) |
| `pedidos_2026` | *(misma planilla)* | — | — | `SHEETS_TAB_DASHBOARD` (default `DASHBOARD`) |
| `asignacion_lotes_2026` | `ASIGNACION DE LOTES 2026` | `PRODUCCION 2026/LOTES` | `GOOGLE_SHEETS_ASIGNACION_LOTES_2026_ID` | `SHEETS_TAB_ASIGNACION_LOTES` (default `ASIGNACION`) |

**Descubrimiento:** si no hay fast-path ID, `operationsDocumentRepository` indexa desde `GOOGLE_DRIVE_GENUS_FOLDER_ID` por nombre de archivo.

### 3.2 Hojas fuera de scope (24 meses)

No consumidas por Genus OS en este contrato:

- OE / OA individuales (Google Docs / hojas por orden)
- MOVIMIENTOS, SALDOS, LIBERACIONES como tablas maestras
- Maestros `CLIENTES` / `PRODUCTOS` separados
- Cualquier otra pestaña de Drive indexada solo para diagnóstico (`/api/v1/drive/health`)

Estas pueden incorporarse en **v0.2+** del contrato con PR dedicado.

---

## 4. Contrato por módulo

### 4.1 Módulo SEMANAS → WorkItems (F10.1)

**Mapper:** `semanas-to-work-items.ts` · **Parser:** `semanas-block-parser.ts`  
**API:** `GET /api/v1/work-items?sector=&ownerPerson=`  
**Modelo destino:** `WorkItem` (`types/operational/work-item.ts`)

#### Estructura visual (no es tabla plana)

La pestaña se organiza en **bloques visuales**. Genus OS interpreta contexto acumulado al recorrer filas:

| Bloque | Contexto visual | Sector destino |
|--------|-----------------|----------------|
| `ELABORACION` | Sub-bloque por elaborador (`CRISTIAN`, `NICOLÁS`, …) | `ELABORACION` |
| `ACONDICIONAMIENTO` + tier masivo | Sub-bloque por línea (`LÍNEA 1/2/3`) | `ENVASADO_MASIVO` |
| `ACONDICIONAMIENTO` + tier premium | Sub-bloque (`PREMIUM A/B`, …) | `ENVASADO_PREMIUM` |
| `ENTREGAS` | — | `DEPOSITO` |
| `DESARROLLO` | — | `PRODUCCION` |

`ownerPerson` y `line` provienen del **bloque visual**, no solo de columnas.

#### Columnas / campos consumidos

Aliases aceptados por fila de datos (primera coincidencia gana):

| Campo WorkItem | Aliases en header/fila | Obligatorio | Notas |
|----------------|------------------------|-------------|-------|
| `client` | `cliente`, `cliente_nombre`, `marca`, `nombre_cliente` | **Sí*** | *Al menos `client` **o** `product` |
| `product` | `producto`, `descripcion`, `granel`, `sku`, `pt`, `nombre` | **Sí*** | *Ver arriba |
| `quantity` | `cantidad`, `kg`, `kilos`, `unidades`, `qty`, `tamano_batch` | No | UI: "Dato no disponible" si falta |
| `unit` | `unidad`, `unit`, `uom` | No | |
| `ownerPerson` | columna `elaborador`/`responsable`/… **o** etiqueta de bloque | **Sí en ELABORACION** | Warning si falta en bloque elaboración |
| `line` | columna inferida **o** etiqueta `LÍNEA n` / `PREMIUM` | **Sí en ACONDICIONAMIENTO** | Warning si falta |
| `dayLabel` | `dia`, `día`, `day` | No | |
| `date` | `fecha`, `fecha_plan`, `inicio` | No | |
| `weekLabel` | `semana`, `week` | No | |
| `deliveryDate` | `entrega`, `fecha_entrega`, `compromiso`, `fecha_compromiso` | No | |
| `pedidoRef` | `pedido`, `pedido_id`, `op`, `oc`, `nro_pedido` | No | Enriquecimiento futuro con PEDIDOS |
| `oeRef` | `oe`, `oe_id`, `orden_elaboracion` | No | Link `/oe/[id]` si presente |
| `oaRef` | `oa`, `oa_id`, `orden_acondicionamiento` | No | |
| `loteRef` | `lote`, `lote_id`, `nro_lote` | No | |
| `notes` | `observaciones`, `obs`, `notas`, `comentarios` | No | |
| `priority` | inferida de texto en fila | No | `URGENTE` … `BAJA` |

**Fallback sin header:** posiciones 0→cliente, 1→producto, 2→cantidad, 3→unidad, 4→entrega.

#### Campos derivados en Next.js (permitidos)

| Campo | Origen | ¿Recalcular en UI? |
|-------|--------|-------------------|
| `sector`, `ownerSector` | bloque + tier + línea | **No** — viene del mapper |
| `originStage` | tipo de bloque | **No** |
| `status` | default `pendiente` | **No** desde SEMANAS hoy (no hay columna estado) |
| `confidence` | heurística de campos mapeados | **No** en React |
| `id` | hash estable fila+bloque | **No** |

#### Vistas que consumen SEMANAS

| Vista / ruta | Sector | Filtro | Columnas UI |
|--------------|--------|--------|-------------|
| `/mi-trabajo` — Envasado Masivo | `ENVASADO_MASIVO` | `line` implícito por usuario | Cliente, Producto, Cantidad, Día, Línea, OA |
| `/mi-trabajo` — Envasado Premium | `ENVASADO_PREMIUM` | idem | idem |
| `/mi-trabajo` — Elaboración | `ELABORACION` | `ownerPerson` (Cristian/Nicolás) | Cliente, Producto, Cantidad, Día, OE, Lote |
| `/mi-trabajo` — Producción (tabs Elaboración/Envasados) | `PRODUCCION` | agregado multi-sector | Sector, Línea/Resp., Cliente, Producto, Cantidad, Día |
| `/plan-semanal`, design-preview F10 | varios | API filters | WorkItems ya mapeados |
| API counts (`work-items.service`) | todos | sector | conteos derivados de lista — **temporal** hasta DASHBOARD |

---

### 4.2 Módulo PEDIDOS → referencias comerciales

**Mapper:** `pedido.mapper.ts` · **Resolver:** `pedido.resolver.ts`  
**API:** `GET /api/v1/pedidos` (lista resumida)

#### Columnas reales conocidas (auditoría playbook)

La hoja `PEDIDOS` en planta **no** sigue el modelo normalizado de `docss/03`. Columnas observadas:

`OP`, `Fecha`, `N° OC`, `CLIENTE`, `PRODUCTO`, `S`, `Q`, `Ml`, `ESTADO`, `N° LOTE`

#### Mapeo contrato → `PedidoSummary`

| Campo Genus OS | Aliases mapper | Obligatorio |
|----------------|----------------|-------------|
| `pedidoId` | `pedidoId`, `PEDIDO_ID`, `pedido`, `id_pedido`, `nro_pedido`, **`OP`** | **Sí** |
| `cliente` | `cliente`, `CLIENTE_ID`, `cliente_nombre`, **`CLIENTE`** | No |
| `producto` | `producto`, `PRODUCTO_ID`, `sku`, `pt`, **`PRODUCTO`** | No |
| `estado` | `estado`, `estado_pedido`, `status`, **`ESTADO`** | No | Texto libre en origen |
| `cantidad` | `cantidad`, `cantidad_pedida`, `qty`, `total`, **`Q`** | No |
| `fecha` | `fecha`, `fecha_pedido`, `fecha_compromiso`, `fechaPedido`, **`Fecha`** | No |

Filas sin `pedidoId` resoluble → **ignoradas**.

#### Vistas

| Vista | Uso |
|-------|-----|
| `/pedido/[id]` | detalle entidad (parcial) |
| Enriquecimiento futuro en tablas SEMANAS | `pedidoRef` ↔ `pedidoId` |
| Producción (futuro) | cruce pedidos vs plan — **no recalcular cumplimiento** hasta contrato de `ESTADO` |

#### Modo acceso

**Solo lectura** en v0.1.

---

### 4.3 Módulo DASHBOARD → KPIs planta

**Estado:** **TBD — requiere discovery aprobado post-contrato**

Genus OS **no** implementará mapper DASHBOARD hasta completar discovery (export/fixture + validación con planta).

#### Intención del contrato (pre-discovery)

| Aspecto | Definición |
|---------|------------|
| Planilla | `PEDIDOS 2026` |
| Pestaña | `DASHBOARD` (override `SHEETS_TAB_DASHBOARD`) |
| Modo | **Solo lectura** |
| API prevista | `GET /api/v1/kpis/dashboard` |
| Modelo previsto | `DashboardKpiSnapshot` (por definir en discovery) |
| Vista principal | `/mi-trabajo` → Producción → tab **KPIs completos** |
| Vista secundaria | Dirección → Panorama (futuro, no bloqueante) |

#### KPIs que **deben** venir de DASHBOARD (lista provisional)

Marcados como **TBD** hasta mapear columnas reales. Categorías esperadas según operación planta:

| Categoría | Ejemplos típicos en planta | Fuente Genus OS post-P4 |
|-----------|----------------------------|-------------------------|
| Cumplimiento / entregas | % pedidos en término, atrasados | **DASHBOARD** |
| Carga por sector | unidades/kg planificados vs capacidad | **DASHBOARD** (no sumar WorkItems) |
| Calidad | lotes pendientes liberación, rechazos período | **DASHBOARD** |
| Excepciones | quiebres, replanificaciones | **DASHBOARD** |
| Indicadores comerciales | OP abiertas, backlog | **DASHBOARD** |

**Placeholder actual (demo / pre-P4):** tab KPIs en Producción usa `buildProductionOverview(workItems)` — agregados locales. Esto es **temporal** y debe reemplazarse por lectura DASHBOARD.

---

### 4.4 Módulo ASIGNACION LOTES → Calidad y lotes

**Mapper:** `lote-asignacion.mapper.ts` · **Resolver:** `lote.resolver.ts`  
**API:** `GET /api/v1/lotes`, `/lote/[id]`

#### Columnas consumidas → `LoteRow` / `QualityItem` (futuro)

| Campo | Aliases | Obligatorio |
|-------|---------|-------------|
| `loteId` | `loteId`, `LOTE_ID`, `id_lote`, `codigo` | **Sí*** |
| `nroLote` | `nroLote`, `nro_lote`, `lote`, `numero_lote`, `asignacion` | **Sí*** |
| `tipoItem` | `tipo`, `tipo_item`, `tipoItem` | No |
| `itemId` | `itemId`, `ITEM_ID`, `producto`, `sku`, `pt` | No |
| `estado` | `estado`, `status`, `estado_lote`, `disposicion` | No |
| `fechaVencimiento` | `fechaVencimiento`, `vencimiento`, `fecha_vencimiento` | No |

*Al menos uno de `loteId` o `nroLote`.

**Nota operativa:** la planilla real puede usar **pestañas mensuales** (`ENERO`…`JUNIO`) además de `ASIGNACION`. El resolver prueba candidatos en orden; el discovery F8.2 fijará la pestaña canónica.

#### Vistas

| Vista | Datos esperados | Fuente hoy |
|-------|-----------------|------------|
| `/mi-trabajo` — Calidad → Elaboración | graneles del día pendientes QC | **Mock** (`mockQualityItems`) |
| `/mi-trabajo` — Calidad → Acondicionamiento | salidas pendientes QC | **Mock** |
| `/mi-trabajo` — Producción → Aprobados/Rechazados | decisiones calidad | Mock + `localStorage` |
| `/lote/[id]` | identificación lote | ASIGNACION (parcial E7.1) |

#### Modo acceso

- **v0.1:** solo lectura  
- **P2 (propuesta):** escritura decisiones calidad — ver §8

---

## 5. Matriz lectura / escritura

| Planilla | Pestaña | Lectura Genus OS | Escritura Genus OS | Escritura AppSheet / manual planta |
|----------|---------|------------------|--------------------|------------------------------------|
| SEMANAS 2026 | SEMANAS/PLAN | ✅ | ❌ v0.1 | ✅ fuente de replanificación |
| PEDIDOS 2026 | PEDIDOS | ✅ | ❌ | ✅ |
| PEDIDOS 2026 | DASHBOARD | ⏳ post-discovery | ❌ | ✅ (fórmulas planta) |
| ASIGNACION LOTES 2026 | ASIGNACION / mensual | ✅ | ❌ v0.1 · ⏳ P2 propuesta | ✅ |

**Scopes Google SA actuales:** `drive.readonly` + `spreadsheets.readonly`.  
**P2 requerirá:** `spreadsheets` + rol Editor en rangos acordados únicamente.

---

## 6. Columnas que Genus OS puede modificar (P2 — propuesta)

> **No implementado.** Rangos sujetos a validación GMP y aprobación de este contrato v0.2.

| Acción UI | Planilla | Columnas / rango propuesto | Modo |
|-----------|----------|----------------------------|------|
| Aprobar lote (Calidad) | ASIGNACION LOTES | `estado` / `disposicion` + `fecha_decision` + `usuario_genus` | update celda o append log |
| Rechazar lote (Calidad) | ASIGNACION LOTES | idem + `motivo_rechazo` | append preferido (GMP) |
| Marcar avance WorkItem | SEMANAS | **No** en v0.2 — replanificación es manual/AppSheet | — |
| Modificar PEDIDOS / DASHBOARD | — | **Prohibido** | — |

**Reglas de escritura:**

1. Append-only donde exista historial GMP.  
2. Una acción = un rango documentado.  
3. Sin triggers Apps Script para lógica de mapeo.  
4. AppSheet y Genus OS no escriben la misma celda — rangos exclusivos por sistema.

**Estado actual:** approve/reject → `localStorage` (`operational-store.ts`); **no** persiste en Sheets.

---

## 7. Vistas Genus OS ↔ fuentes de datos

| Ruta / superficie | Sectores | Fuentes | Polling |
|-------------------|----------|---------|---------|
| `/mi-trabajo` | todos operativos | SEMANAS (+ mock Calidad) | 30s + Refrescar |
| `/login` → sector | — | sesión mock | — |
| `/plan-semanal` | planificación | SEMANAS | API |
| `/pedido/[id]` | — | PEDIDOS | bajo demanda |
| `/lote/[id]` | — | ASIGNACION LOTES | bajo demanda |
| `/api/v1/work-items` | filtro sector/persona | SEMANAS | cache server TTL |
| `/api/v1/kpis/dashboard` | — | DASHBOARD | ⏳ P4 |

**Filtros server-side obligatorios:**

- Elaboración: `ownerPerson` (no reagrupar en React).  
- Envasado: `sector` + `line` según perfil.  
- Producción: todos los WorkItems SEMANAS + qualityItems (ASIGNACION futuro).

---

## 8. Qué NO debe recalcularse en Next.js

Genus OS **prohibido** replicar en código lo que Sheets ya calcula o lo que es responsabilidad de planta/AppSheet.

| Dato / métrica | Fuente correcta | Comportamiento incorrecto (evitar) |
|----------------|-----------------|-----------------------------------|
| KPIs agregados planta | **DASHBOARD** | Sumar WorkItems para "% cumplimiento" |
| Cumplimiento pedidos | **DASHBOARD** / fórmulas PEDIDOS | Derivar enum desde `ESTADO` texto libre |
| Capacidad / carga real | **DASHBOARD** | `buildProductionOverview().capacity` como KPI oficial |
| Saldos / movimientos | MOVIMIENTOS (fuera scope) | Inferir stock desde SEMANAS |
| Estado liberación legal | LIBERACIONES / DT | Marcar liberado desde Calidad UI sin hoja |
| Prioridad global replanificada | SEMANAS (visual) | Recalcular prioridades cruzando PEDIDOS en Next |
| Bloques elaborador / línea | SEMANAS parser | Reagrupar filas en componentes React |
| Trazabilidad append-only | MOVIMIENTOS | Insertar filas inventadas |

### Excepciones permitidas (derivaciones locales, no KPI oficiales)

| Derivación | Uso | Etiquetado en UI |
|------------|-----|------------------|
| Conteo WorkItems por sector | tablas operativas, badges | "Items en plan" — no "KPI oficial" |
| `buildProductionOverview` | preview/demo, tab KPIs **temporal** | Reemplazar por DASHBOARD en P4 |
| Filtros `pendiente` / `hoy` | UX operativa | Sobre conjunto ya mapeado |
| `confidence` / warnings mapper | diagnóstico | Solo dev/logs |

---

## 9. APIs y adapters (referencia)

```
Lectura (vigente)
  GET /api/v1/drive/health
  GET /api/v1/drive/refresh?scope=all|critical_sheets|…
  GET /api/v1/work-items?sector=&ownerPerson=
  GET /api/v1/pedidos
  GET /api/v1/lotes

Lectura (pendiente contrato + discovery)
  GET /api/v1/kpis/dashboard

Escritura (pendiente P2 + contrato v0.2)
  POST /api/v1/quality/decisions
```

**Adapter operativo UI:** `operational-sheets-adapter.ts` — API work-items + fallback demo.

---

## 10. Validación y cambios al contrato

### Criterios de aprobación v0.1

- [ ] Planta confirma columnas SEMANAS por bloque (muestra real o fixture).  
- [ ] Planta confirma columnas PEDIDOS (`OP`, `ESTADO`, …).  
- [ ] Se acepta lista TBD de KPIs DASHBOARD como entrada al discovery.  
- [ ] Se acepta propuesta P2 de rangos Calidad (o se marca "solo lectura" extendido).  
- [ ] Se confirma pestaña canónica ASIGNACION vs mensuales.

### Proceso de cambio

1. Cambio en planilla real → actualizar este doc **antes** del mapper.  
2. Bump versión (`0.1` → `0.2`) + PR en `docss/`.  
3. Fixture en `__fixtures__/` refleja el contrato aprobado.  
4. Tests de mapper fallan si se rompe contrato.

### Próximo paso tras aprobación

1. **Discovery DASHBOARD** — export, fixture, propuesta columnas KPI.  
2. **F8.2 ASIGNACION** — quality items reales + fixture mensual.  
3. **P4** — `pedidos-dashboard.mapper.ts` + tab KPIs real.  
4. **P2** — contrato v0.2 escritura Calidad.

---

## 11. Relación con otros documentos

| Doc | Relación |
|-----|----------|
| `29-sheets-integration-strategy.md` | Prioridades P1–P5; este contrato las detalla |
| `27-f10-semanas-visual-blocks.md` | Detalle técnico parser SEMANAS |
| `03-modelo-de-datos.md` | Modelo ideal futuro; **no** describe planillas reales |
| `playbook/03_GENUS_OS_CURSOR_PLAYBOOK.md` | Auditoría columnas reales PEDIDOS |
| PR #47 `/mi-trabajo` operativo | UI sujeta a este contrato |

---

## Changelog

| Versión | Fecha | Cambio |
|---------|-------|--------|
| 0.1 | 2026-07-03 | Borrador inicial pre-discovery DASHBOARD |
