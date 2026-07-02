# 28 — Estrategia de convergencia Genus OS v1.0

> **Estado:** Fase 2 completada — Fase 3 planificada  
> **Patrón:** Strangler Fig (convivencia controlada, sin big bang)  
> **Principio:** Continuidad operativa — cada PR compila, despliega y funciona  
> **Rama integración Fase 2:** `cursor/f2-1-work-lib-relocate-3d8a` (PRs #22–#28 mergeados)

---

## 1. Decisión arquitectónica

Genus OS v1.0 converge hacia **un solo producto**:

| Dimensión | Legacy (Track A) | Objetivo (Track B → producción) |
|-----------|------------------|----------------------------------|
| Shell | `AppShell` workspaces | `TwinShell` OS |
| Modelo de tarea | `BandejaTask` / mocks | `WorkItem` canónico |
| Navegación | Workspaces F7 | Role Engine sectorial F9 |
| Entry | `/bandeja` | `/mi-trabajo` (Fase 3) |
| Design tokens | `styles/tokens.css` doc 07 | `--genus-*` F9.5 + alias `--os-*` |

**Motores preservados intactos:** Role Engine · Workflow Engine · Action Pipeline · Mappers SEMANAS.

---

## 2. Reglas de migración (inviolables)

1. **Continuidad operativa** — nunca una rama donde Genus OS deje de funcionar.
2. **PRs pequeños** — un cambio reversible por PR; desplegable independientemente.
3. **Mover antes de reescribir** — el Digital Twin ya es el producto; relocate, no rediseño.
4. **Extraer primitivos antes de eliminar** — unificar tokens/EmptyState antes de borrar legacy.
5. **Eliminar solo con reemplazo validado** — redirects temporales antes de delete.
6. **Migrar ideas mejores** — si legacy tiene UX superior, portarla antes de eliminar.
7. **Modelo operativo** — Trabajo → Estado → Acción → Datos en cada decisión.

---

## 3. Fases de convergencia

### Fase 0 — Red de seguridad ✅

| PR | Alcance | Estado |
|----|---------|--------|
| 0.1 | Vitest + tests mapper SEMANAS F10.1 | ✅ #17 |
| 0.2 | Tests Role Engine + Workflow Engine | ✅ #18 |
| 0.3 | Eliminar 6 módulos huérfanos (reemplazo validado) | ✅ #19 |
| 0.4 | Docs + `/playbook` + doc 23 sincronizado | ✅ #20 |

### Fase 1 — Unificación de primitivos ✅

| PR | Alcance | Estado |
|----|---------|--------|
| 1.1 | Alias `--os-*` → `--genus-*` + status labels + EmptyState | ✅ #21 |

**Trade-off Fase 1.1:** se mantienen nombres `--os-*` en wireframes como alias reversibles hacia `--genus-*` (`genus-os-bridge.css`). Evita renombrar decenas de referencias; la fuente canónica ya es Genus DS.

---

### Fase 2 — Relocate (`design-preview/` → `features/`) ✅

**Objetivo:** relocate estructural vía `git mv` + stubs re-export. Sin rename Twin/OS, sin mover `tokens.css`, sin tocar rutas ni engines.

| PR | Alcance | Estado |
|----|---------|--------|
| 2.1 | `features/work/lib` — calendar, work-items-day-view, search, creamy-copilot | ✅ #22 |
| 2.2 | `features/work/hooks` + `features/work/components` | ✅ #23 |
| 2.3 | `features/os/session` + `feedback` + `navigation` | ✅ #24 |
| 2.4 | `features/os/shell` — twin-shell, os-header, os-sidebar, action-toast | ✅ #25 |
| 2.5 | `features/sectors` — registry, config, mock-data, placeholders, wireframes | ✅ #26 |
| 2.6 | `features/work/views` + `features/os/app` — plan-semanal, consulta, twin-app | ✅ #27 |
| 2.7 | `features/entities/views` — detail-views, stub-views | ✅ #28 |

#### Estructura lograda (Fase 2)

```
frontend/src/features/
├── work/
│   ├── lib/           calendar, work-items-day-view, search-work-items, creamy-copilot
│   ├── hooks/         use-sector-work-items, use-multi-sector-work-items
│   ├── components/    line-work-card, date-navigator, week-plan-strip, …
│   └── views/         plan-semanal, consulta
├── os/
│   ├── session/       preview-context
│   ├── navigation/    twin-nav
│   ├── feedback/      context-panel, creamy-companion
│   ├── shell/         twin-shell, os-header, os-sidebar, action-toast
│   └── app/           design-preview-app, twin-app (TwinRouter)
├── sectors/
│   ├── registry/      sector-view-registry
│   ├── config/        config, lab-personas, sector-emails
│   ├── mock-data/     mock-data
│   ├── components/    sector-login, sector-home-placeholder
│   └── wireframes/    7 wireframes sectoriales
└── entities/
    └── views/         detail-views, stub-views
```

#### Qué quedó en `design-preview/`

| Tipo | Contenido |
|------|-----------|
| **Archivo real** | `tokens.css` únicamente |
| **Stubs re-export** | ~39 archivos en `lib/`, `hooks/`, `components/`, `wireframes/`, `views/` y raíz |
| **Entry route** | `app/design-preview/page.tsx` — sin cambios; importa stubs + tokens |

#### Deuda técnica intencional (Fase 2)

- **~86 imports** en 24 archivos bajo `features/` siguen usando `@/design-preview/*` vía stubs.
- Nombres semánticos sin renombrar: `PreviewProvider`, `TwinRouter`, `TwinShell`, etc.
- `Role Engine` / `Workflow Engine` / mappers: sin cambios estructurales.

#### Verificación Fase 2

- 28 tests Vitest passing
- `/design-preview` operativo (HTTP 200, login sectorial, navegación completa)
- Cero regresiones en Track A legacy

---

### Fase 3 — Rutas OS en producción (planificada)

**Objetivo:** exponer el Digital Twin como rutas productivas manteniendo `/design-preview` como alias de compatibilidad, sin eliminar Track A.

**Granularidad:** 12 PRs agrupados (reversibles, sin big bang).

| PR | Alcance |
|----|---------|
| **3.1** | Work imports — `features/work/*` → `@/features/work/*` |
| **3.2** | OS imports — shell, feedback, session, app → `@/features/os/*` |
| **3.3** | Sectors imports — `features/sectors/*` → `@/features/sectors/*` + cross-refs OS/work |
| **3.4** | Entities imports + auditoría 0 `@/design-preview/` en `features/` |
| **3.5** | Tokens move + stub + imports `app/design-preview` |
| **3.6** | `OsAppRoot` compartido |
| **3.7** | Ruta `/mi-trabajo` |
| **3.8** | Rutas `/plan-semanal` y `/consulta` |
| **3.9** | `/design-preview` como alias de `OsAppRoot` |
| **3.10** | Banners legacy + flag redirects opt-in |
| **3.11** | Redirects opt-in (middleware 302 con flag) |
| **3.12** | Documentación cierre Fase 3 |

**Reglas permanentes Fase 3:**
- Cada PR: `npm run test`, `npm run lint`, `npm run build`, smoke `/design-preview`
- Stubs en `design-preview/` intactos hasta cierre Fase 3
- No eliminar Track A · no renombrar Twin/OS · rollback = revert PR

#### PR 3.1 — Work imports ✅

Migrados imports work-domain en `features/work/` → `@/features/work/*`. Merge #30.

#### PR 3.2 — OS imports ✅

Merge #31.

#### PR 3.3 — Sectors imports ✅

Migrados `features/sectors/*` y imports OS→sectors/work. Merge #32.

#### PR 3.4 — Entities imports + auditoría ✅

Migrados `features/entities/views/*` y los 2 imports restantes de `twin-app` → `@/features/*`. **0 imports `@/design-preview/*` en `features/`.** Merge #33.

#### PR 3.5 — Tokens move + stub ✅

`design-preview/tokens.css` → `design-system/os-preview-tokens.css` (canónico). Stub `@import` en path original. `app/design-preview` importa path canónico. Merge #34.

#### PR 3.6 — OsAppRoot compartido ✅

Extraído `OsAppRoot` en `features/os/app/os-app-root.tsx`. `DesignPreviewApp` delega sin cambiar `/design-preview`. Merge #35.

#### PR 3.7 — Ruta `/mi-trabajo` ✅

Nueva ruta productiva `app/mi-trabajo/` importa `OsAppRoot` directamente. `/design-preview` sin cambios. Merge #36.

#### PR 3.8 — Rutas `/plan-semanal` y `/consulta` ✅

Rutas productivas con `OsAppRoot initialNav` por vista. `PreviewProvider` acepta `initialNav` (default `mi-trabajo`). Merge #37.

#### PR 3.9 — `/design-preview` alias de `OsAppRoot` ✅

`app/design-preview/page.tsx` importa `OsAppRoot` directamente. Merge #38.

#### PR 3.10 — Banners legacy + flags opt-in ✅

`OsLegacyConvergenceBanner` en AppShell (flag `NEXT_PUBLIC_GENUS_OS_LEGACY_BANNER`). Flags de redirect definidos; middleware en 3.11.

#### Criterios de cierre Fase 3

- [x] `@/design-preview/*` solo usado desde `app/` y stubs (no desde `features/`)
- [x] `tokens.css` en path canónico con stub de compatibilidad
- [x] `/mi-trabajo`, `/plan-semanal`, `/consulta` operativos
- [x] `/design-preview` sigue operativo como alias de `OsAppRoot`
- [ ] Track A intacto; redirects soft activos; hard redirects detrás de flag
- [ ] Validación operaria en planta (manual)

<!-- Detalle histórico sub-fases 3A–3D (21 PRs) reemplazado por plan 12 PRs arriba -->

---

### Fase 4 — Fusión object pages

- Detalle trabajo/OE/OA dentro del shell OS
- Entity pages con datos reales (Drive)

### Fase 5 — Workflow Engine + write-back

- Producción consume `analyzeWorkflow()`
- Acciones → Action Pipeline → Sheets

### Fase 6 — Eliminación Track A

- Precondición: 30 días sin tráfico legacy + operarios validaron OS
- Delete workspaces, OperationsStore mocks, tokens doc 07

---

## 4. Árbol objetivo v1.0

Ver auditoría arquitectónica §10 — estructura `features/os|sectors|work|entities` (**implementada en Fase 2**).

---

## 5. Qué NO hacer

- Big bang delete del Track A
- Reescribir wireframes sectoriales
- Migrar workspaces uno a uno al Role Engine
- Integrar Workflow Engine antes de estabilizar rutas (Fase 3)
- Renombrar Twin/OS antes de rutas productivas validadas
- Sacrificar arquitectura, UX o modelo operativo por velocidad

---

## 6. Referencias

- Auditoría arquitectónica completa — conversación Fase 0
- `docss/23-f9-rediseno-os-planta.md` — visión OS de planta
- `docss/24-role-engine.md` · `docss/25-workflow-engine.md`
- `docss/26-genus-design-system.md`
- `/playbook` — proceso de ejecución
- PRs Fase 2: #22–#28 sobre `cursor/f2-1-work-lib-relocate-3d8a`
