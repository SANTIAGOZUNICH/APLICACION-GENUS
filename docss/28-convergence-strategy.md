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

**Precondición:** merge de rama Fase 2 en rama principal de trabajo (`f10-1` o equivalente).

#### Sub-fase 3A — Migración de imports internos

Reemplazar `@/design-preview/*` → `@/features/*` **solo dentro de `features/`**. Los stubs permanecen para `app/` y cualquier consumidor externo hasta validación.

| PR | Alcance | Archivos aprox. | Rollback |
|----|---------|-----------------|----------|
| **3.1** | `features/work/components` + `features/work/views` → imports directos work | 5 archivos, ~18 imports | revert PR |
| **3.2** | `features/work/` restante (cross-refs ya resueltos en 3.1) | verificación grep | revert PR |
| **3.3** | `features/os/shell` + `features/os/feedback` | 6 archivos, ~10 imports | revert PR |
| **3.4** | `features/os/session` + `features/os/app` | 4 archivos, ~9 imports | revert PR |
| **3.5** | `features/sectors/components` + wireframes livianos (calidad, deposito, direccion) | 5 archivos | revert PR |
| **3.6** | `features/sectors/wireframes` operativos (elaboracion, envasado-*) | 3 archivos, ~36 imports | revert PR |
| **3.7** | `features/entities/views` | 2 archivos, ~8 imports | revert PR |
| **3.8** | Auditoría: grep `@/design-preview/` en `features/` = 0; stubs intactos | solo verificación + doc | N/A |

**Reglas 3A:**
- No eliminar stubs en estos PRs.
- No tocar `app/design-preview/*`.
- Cada PR: `npm run test`, `npm run lint`, `npm run build`, smoke `/design-preview`.

#### Sub-fase 3B — Resolución de `tokens.css`

| PR | Alcance | Rollback |
|----|---------|----------|
| **3.9** | Mover `design-preview/tokens.css` → `design-system/os-preview-tokens.css` (git mv) | revert PR |
| **3.10** | Stub `@import` o re-export en path original `design-preview/tokens.css` | revert PR |
| **3.11** | Actualizar imports en `app/design-preview/layout.tsx` y `page.tsx` al path canónico (stubs siguen funcionando) | revert PR |

**Reglas 3B:**
- No renombrar variables `--os-*`.
- No cambiar `genus-os-bridge.css`.
- Verificar tokens en `/design-preview` y `/design-system`.

#### Sub-fase 3C — Rutas productivas OS

| PR | Alcance | Rollback |
|----|---------|----------|
| **3.12** | Extraer `OsAppRoot` compartido desde `design-preview-app` (wrapper: tokens + PreviewProvider + root div). `design-preview-app` delega sin cambio visual. | revert PR |
| **3.13** | Prop opcional `initialNav` en app root para deep-link de vista (plan-semanal, consulta). Sin rename Twin/OS. | revert PR |
| **3.14** | Ruta `/mi-trabajo` — renderiza `OsAppRoot` + `TwinRouter`, metadata productiva | revert PR |
| **3.15** | Ruta `/plan-semanal` — `initialNav: plan-semanal` | revert PR |
| **3.16** | Ruta `/consulta` — `initialNav: consulta` | revert PR |
| **3.17** | `/design-preview` refactorizado para usar `OsAppRoot` (alias funcional, metadata preview) | revert PR |

**Reglas 3C:**
- Rutas nuevas fuera de `(app)/` legacy — route group `(os)/` sin AppShell.
- Misma lógica operativa que `/design-preview`; cero cambio visual.
- Smoke obligatorio: login, Mi Trabajo, Plan semanal, Consulta, detalle + Volver en **ambas** rutas.

#### Sub-fase 3D — Redirects y convivencia Track A

| PR | Alcance | Rollback |
|----|---------|----------|
| **3.18** | Banner informativo en `/bandeja` → enlace a `/mi-trabajo` (sin redirect automático) | revert PR |
| **3.19** | Mapa de redirects documentado en doc 28 + feature flag `NEXT_PUBLIC_OS_ROUTES_ENABLED` | doc only |
| **3.20** | Middleware opt-in: redirect 302 `/bandeja` → `/mi-trabajo` solo con flag activo | revert PR + flag off |
| **3.21** | Banners informativos en workspaces legacy (`/produccion`, `/calidad`, `/deposito`, `/direccion`) | revert PR |

**Reglas 3D:**
- **No eliminar** páginas legacy.
- Redirects hard solo con flag explícito.
- Default: convivencia — Track A sigue accesible.

#### Criterios de cierre Fase 3

- [ ] `@/design-preview/*` solo usado desde `app/` y stubs (no desde `features/`)
- [ ] `tokens.css` en path canónico con stub de compatibilidad
- [ ] `/mi-trabajo`, `/plan-semanal`, `/consulta` operativos
- [ ] `/design-preview` sigue operativo como alias
- [ ] Track A intacto; redirects soft activos; hard redirects detrás de flag
- [ ] Validación operaria en planta (manual)

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
