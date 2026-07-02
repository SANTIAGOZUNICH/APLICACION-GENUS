# 24 — Role Engine: Motor de Sectores Genus OS

> **Estado:** F9.3 — implementado en `src/lib/role-engine/`  
> **Alcance:** arquitectura de configuración por sector. Sin Login, sin RBAC, sin backend.  
> **Objetivo:** que cada empleado sienta una app diseñada para su puesto, compartiendo la misma arquitectura.

---

## 1. Filosofía

Genus OS no es un ERP con pantallas distintas hardcodeadas. Es un **sistema operativo de planta** donde cada sector es una **aplicación distinta**, armada desde la misma base.

El **Role Engine** responde:

- qué ve cada sector
- qué acciones tiene disponibles
- qué WorkItems consume
- qué paneles aparecen en la Home
- qué contexto utiliza Creamy (copiloto, no chatbot)

**No es Login.** El login (F10) solo asignará un `sectorId` al usuario.  
**No es RBAC.** Los permisos finos vienen después.  
**Es configuración declarativa** — un sector = un `SectorDefinition`.

---

## 2. Arquitectura

```text
Usuario (futuro F10)
        ↓
   SectorId
        ↓
   Role Engine
        ↓
 SectorDefinition (registry)
        ↓
   ResolvedSectorHome
        ↓
 View Registry → Componentes React
```

### Capas

| Capa | Ubicación | Responsabilidad |
|------|-----------|-----------------|
| **Types** | `role-engine/types.ts` | Contratos: layouts, paneles, acciones, Creamy |
| **Sector Definition** | `role-engine/sector-definition.ts` | Helpers para definir y resolver paneles/sidebar |
| **Sector Registry** | `role-engine/sector-registry.ts` | Las 10 definiciones de sector |
| **Role Engine** | `role-engine/role-engine.ts` | `resolveSectorHome`, `renderSectorHome` |
| **View Registry** | `design-preview/sector-view-registry.tsx` | Mapeo viewKey → wireframe (puente preview) |

---

## 3. Flujo de resolución

```typescript
import { renderSectorHome, resolveSectorHome } from "@/lib/role-engine";

// 1. Resolver configuración (sin React)
const home = resolveSectorHome("ENVASADO_MASIVO");
// → layout, panels, quickActions, creamyContext, homeViewKey, ...

// 2. Renderizar Home (única entrada)
renderSectorHome("ENVASADO_MASIVO", SECTOR_VIEW_REGISTRY);
```

El engine **no contiene `if (sector === "...")`**. Toda la lógica sale del registry.

---

## 4. SectorDefinition

Cada sector se define **únicamente por configuración**:

```typescript
{
  id: "ENVASADO_MASIVO",
  title: "Envasado Masivo",
  description: "...",
  homeLayout: "packaging_lines",
  visiblePanels: ["header_greeting", "date_navigator", "summary_strip", ...],
  quickActions: ["open_oa", "create_oa", "mark_done", "report_problem"],
  visibleEntities: ["work_item", "oa", "pedido", "plan_semanal"],
  workItemSources: ["semanas_2026"],
  allowedActions: ["Crear OA", "Abrir OA", ...],
  sidebarItems: ["mi_trabajo", "plan_semanal", ...],
  creamyContext: {
    role: "Copiloto de envasado masivo",
    topics: ["prioridades", "OA", "bloqueos", "insumos"],
    defaultHint: "...",
    baseSuggestions: ["Ver plan semanal", ...],
  },
  emptyState: { title: "...", message: "..." },
  homeViewKey: "envasado-masivo-home",
  dataMode: "work_items" | "mock" | "placeholder",
}
```

### Layouts disponibles

| Layout | Sectores |
|--------|----------|
| `packaging_lines` | Envasado Masivo, Premium |
| `work_blocks` | Elaboración |
| `lab_bench` | Calidad |
| `prep_checklist` | Depósito |
| `control_tower` | Producción |
| `executive_signals` | Dirección |
| `encoding_queue` | Codificado |
| `supply_prep` | Materia Prima |
| `commercial_pipeline` | Comercial |
| `placeholder` | Sectores en preparación |

---

## 5. Registry — sectores registrados

| Sector | dataMode | Home |
|--------|----------|------|
| Elaboración | mock | wireframe existente |
| Envasado Masivo | **work_items** | wireframe + Role Engine panels |
| Envasado Premium | mock | wireframe existente |
| Codificado | placeholder | SectorHomePlaceholder |
| Calidad | mock | wireframe existente |
| Depósito | mock | wireframe existente |
| Materia Prima | placeholder | SectorHomePlaceholder |
| Comercial | placeholder | SectorHomePlaceholder |
| Producción | mock | wireframe existente |
| Dirección | mock | wireframe existente |

---

## 6. Creamy — copiloto por sector

Creamy **no es un chatbot genérico**. Cada sector define:

- `role` — identidad del copiloto
- `topics` — dominios de ayuda
- `defaultHint` — mensaje sin trabajo activo
- `baseSuggestions` — chips base

Ejemplos:

| Sector | Creamy ayuda con |
|--------|------------------|
| Envasado | prioridades, OA, bloqueos, insumos |
| Calidad | lotes, liberaciones, análisis |
| Producción | cuellos de botella, carga, planificación |

La capa dinámica (`buildCopilotContext`) combina la definición del sector con el estado real de WorkItems.

---

## 7. Integración con design-preview (F9.3)

`/design-preview` usa el Role Engine para pantallas de sector:

```typescript
// design-preview-canvas.tsx
if (isRoleEngineScreen(screenId)) {
  return renderSectorHome(sectorId, SECTOR_VIEW_REGISTRY);
}
```

Pantallas utilitarias (Arquitectura, Plan semanal, Consulta) quedan fuera del engine.

**Envasado Masivo** ya consulta paneles vía `sectorHasPanel()` — demostración del patrón sin duplicar lógica.

---

## 8. Integración futura con Login (F10)

```text
email del usuario
        ↓
resolver sectorId (config / directory)
        ↓
renderSectorHome(sectorId, APP_VIEW_REGISTRY)
        ↓
Home del sector — sin modificar pantallas
```

No habrá que tocar wireframes ni componentes. Solo:

1. Asignar `sectorId` al autenticarse
2. Llamar `renderSectorHome(sectorId, registry)`
3. Opcionalmente filtrar `sidebarItems` por rol en F10+

---

## 9. Cómo agregar un nuevo sector

1. Agregar `SectorId` en `types/operational/sector.ts` (si no existe).
2. Crear entrada en `sector-registry.ts` con `defineSector({ ... })`.
3. Implementar componente Home y registrar en `sector-view-registry.tsx`.
4. Definir `creamyContext` específico del sector.
5. Migrar datos: `dataMode: "work_items"` cuando el mapper esté listo.

**No** agregar `if (sector)` en componentes React.

---

## 10. API pública

```typescript
// Resolución
resolveSectorHome(sectorId)
resolveAllSectorHomes()
sectorHasPanel(sectorId, panelId)
sectorHasQuickAction(sectorId, actionId)

// Registry
getSectorDefinition(sectorId)
getAllSectorDefinitions()
assertSectorDefinition(sectorId)

// Render
renderSectorHome(sectorId, viewRegistry)
```

---

## 11. Restricciones F9.3

- No se modificó backend, Drive, Discovery, Mappers ni WorkItems.
- No se crearon pantallas nuevas en la app real.
- Codificado, Materia Prima y Comercial usan placeholder hasta migración.
- Los wireframes legacy siguen funcionando vía view registry.

---

## 12. Próximo paso (F9.4+)

Migrar sector por sector al patrón Envasado Masivo:

1. Leer `resolveSectorHome(sectorId)` en el wireframe
2. Renderizar paneles con `sectorHasPanel()`
3. Creamy desde `home.creamyContext`
4. Cambiar `dataMode` a `work_items` cuando corresponda

Cuando todos los sectores estén migrados, promover `renderSectorHome` a la app principal.
