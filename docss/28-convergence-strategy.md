# 28 — Estrategia de convergencia Genus OS v1.0

> **Estado:** Aprobada — Fase 0 en ejecución  
> **Patrón:** Strangler Fig (convivencia controlada, sin big bang)  
> **Principio:** Continuidad operativa — cada PR compila, despliega y funciona

---

## 1. Decisión arquitectónica

Genus OS v1.0 converge hacia **un solo producto**:

| Dimensión | Legacy (Track A) | Objetivo (Track B → producción) |
|-----------|------------------|----------------------------------|
| Shell | `AppShell` workspaces | `TwinShell` OS |
| Modelo de tarea | `BandejaTask` / mocks | `WorkItem` canónico |
| Navegación | Workspaces F7 | Role Engine sectorial F9 |
| Entry | `/bandeja` | `/mi-trabajo` (futuro Fase 3) |
| Design tokens | `styles/tokens.css` doc 07 | `--genus-*` F9.5 |

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

### Fase 0 — Red de seguridad (actual)

| PR | Alcance | Estado |
|----|---------|--------|
| 0.1 | Vitest + tests mapper SEMANAS F10.1 | ✅ |
| 0.2 | Tests Role Engine + Workflow Engine | ✅ |
| 0.3 | Eliminar 6 módulos huérfanos (reemplazo validado) | ✅ |
| 0.4 | Docs + `/playbook` + doc 23 sincronizado | En curso |

### Fase 1 — Unificación de primitivos

- Alias `--os-*` → `--genus-*`
- Unificar `EmptyState`, status labels
- Sin mover rutas

### Fase 2 — Relocate (`design-preview/` → `features/`)

- Renombrar namespace; mantener `/design-preview` como alias
- `preview-context` → `os-session-context`

### Fase 3 — Rutas OS en producción

- `/mi-trabajo`, `/plan-semanal`, `/consulta`
- Redirects desde `/bandeja` y workspaces legacy

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

Ver auditoría arquitectónica §10 — estructura `features/os|sectors|work|entities`.

---

## 5. Qué NO hacer

- Big bang delete del Track A
- Reescribir wireframes sectoriales
- Migrar workspaces uno a uno al Role Engine
- Integrar Workflow Engine antes de estabilizar estructura (Fase 2)
- Sacrificar arquitectura, UX o modelo operativo por velocidad

---

## 6. Referencias

- Auditoría arquitectónica completa — conversación Fase 0
- `docss/23-f9-rediseno-os-planta.md` — visión OS de planta
- `docss/24-role-engine.md` · `docss/25-workflow-engine.md`
- `docss/26-genus-design-system.md`
- `/playbook` — proceso de ejecución
