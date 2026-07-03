# 25 — Motor de Flujo Operativo (Workflow Engine)

> **Estado:** F9.4 — arquitectura en `src/lib/workflow-engine/`  
> **Alcance:** conocimiento operativo de planta. Sin UI, sin backend, sin modificar WorkItems ni Role Engine.  
> **Objetivo:** que Genus OS **entienda cómo fluye el trabajo**, no solo cómo mostrarlo.

---

## 1. Filosofía

Genus OS separa dos responsabilidades:

| Motor | Pregunta que responde |
|-------|----------------------|
| **Role Engine** (doc 24) | ¿Qué ve cada sector? ¿Qué paneles, acciones y contexto Creamy? |
| **Workflow Engine** (este doc) | ¿Cómo fluye el trabajo por la planta? ¿Quién depende de quién? |

El Workflow Engine **no renderiza UI**. Reutiliza los **WorkItems existentes** como input y devuelve conocimiento estructurado.

```text
Google Sheets → Discovery → Mapper → WorkItems
                                        ↓
                               Workflow Engine  ← F9.4
                                        ↓
                                  Role Engine
                                        ↓
                                         UI
```

---

## 2. Diferencia con Role Engine

| Aspecto | Role Engine | Workflow Engine |
|---------|-------------|-----------------|
| Unidad | Sector (usuario) | Etapa (planta) |
| Output | Home, paneles, Creamy topics | Bloqueos, dependencias, carga |
| Modifica UI | Sí (indirectamente) | **No** |
| Conoce WorkItems | Consume sector filtrado | Analiza flujo completo |
| Duplica lógica | No debe duplicar flujo | No debe duplicar presentación |

---

## 3. Arquitectura

```text
src/lib/workflow-engine/
├── index.ts                 ← API pública
├── types.ts                 ← WorkflowStageDefinition, ResolvedWorkflow, ...
├── workflow-definition.ts     ← helpers declarativos
├── workflow-registry.ts       ← 10 etapas registradas
└── workflow-engine.ts         ← resolveWorkflow, analyzeWorkflow, Creamy context
```

### WorkflowStageDefinition

Cada etapa se define **solo por configuración**:

```typescript
{
  id: "ENVASADO_MASIVO",
  title: "Envasado Masivo",
  previousStages: ["ELABORACION", "PLANIFICACION"],
  nextStages: ["CODIFICADO"],
  dependsOn: ["Granel elaborado", "Granel liberado", "OA creada o por crear"],
  generates: ["OA", "Producto terminado envasado"],
  completesWhen: ["OA finalizada", "Unidades registradas"],
  blocks: ["CODIFICADO"],
  unblocks: ["CODIFICADO"],
  producedEntities: ["oa"],
  sectorIds: ["ENVASADO_MASIVO"],
  originStages: ["ACONDICIONAMIENTO"],
}
```

---

## 4. Etapas registradas

| Etapa | Recibe de | Genera | Habilita |
|-------|-----------|--------|----------|
| Comercial | — | Pedido | Planificación |
| Desarrollo | Comercial | Muestra, fórmula | Planificación, Elaboración |
| Planificación | Comercial, Desarrollo | Plan SEMANAS | Elaboración, Envasado |
| Elaboración | Planificación | OE, granel | Envasado M/P |
| Envasado Masivo | Elaboración | OA | Codificado |
| Envasado Premium | Elaboración | OA | Codificado |
| Codificado | Envasado | Lote codificado | Calidad |
| Calidad | Codificado | Liberación | Depósito |
| Depósito | Calidad | Entrega | — |
| Dirección | — (observa) | Señales | — |

Cadena principal: `COMERCIAL → DESARROLLO → PLANIFICACION → ELABORACION → ENVASADO_MASIVO → CODIFICADO → CALIDAD → DEPOSITO`

---

## 5. API pública

### Por WorkItem

```typescript
import { resolveWorkflow, isBlocked, getBlockingReason } from "@/lib/workflow-engine";

const workflow = resolveWorkflow(workItem, allWorkItems);
// → stage, previousStages, nextStages, isBlocked, blockingReasons, enablesStages

isBlocked(workItem, allWorkItems);
getBlockingReason(workItem, allWorkItems);
resolveNextStage(workItem);
resolvePreviousStage(workItem);
```

### Análisis de planta (Producción / Creamy)

```typescript
import {
  analyzeWorkflow,
  getBlockedWorkItems,
  getWaitingWorkItems,
  getStageLoad,
  getBottleneckStage,
} from "@/lib/workflow-engine";

const analysis = analyzeWorkflow(allWorkItems);
// → blocked, waiting, stageLoad, bottleneck
```

### Contexto Creamy (sin IA — F9.4 prepara, F10+ consume)

```typescript
import { buildWorkflowCopilotContext } from "@/lib/workflow-engine";

// "¿Por qué no puedo empezar?"
buildWorkflowCopilotContext("why_blocked", workItem, allWorkItems);

// "¿Qué pasa cuando complete esta OA?"
buildWorkflowCopilotContext("what_happens_next", workItem);

// "¿Qué sector está bloqueado?"
buildWorkflowCopilotContext("bottleneck", null, allWorkItems);
```

---

## 6. Mapeo WorkItem → etapa

El engine **no modifica WorkItems**. Infiere la etapa desde campos existentes:

1. `workItem.sector` → etapa (ej. `ENVASADO_MASIVO`)
2. Fallback: `workItem.originStage` del mapper SEMANAS
3. Distinción Masivo/Premium en `ACONDICIONAMIENTO`

Bloqueos se detectan combinando:

- `status === "bloqueado"`
- `blockedBy`, `dependsOn` del WorkItem
- Etapas anteriores incompletas (mismo pedido/OE/OA/lote/cliente+producto)
- Entidades faltantes (OE, OA, lote según etapa)

---

## 7. Integración futura

### Con Role Engine

El Role Engine **permanece intacto**. En F10+ podrá consultar:

```typescript
const workflow = resolveWorkflow(item, items);
// Usar workflow.blockingReasons en context_panel
// Usar workflow.enablesStages en Creamy del sector
```

### Con Creamy AI

| Pregunta operativa | Función |
|--------------------|---------|
| ¿Por qué está detenido? | `buildWhyBlockedContext` |
| ¿Qué pasa al terminar OA? | `buildWhatHappensNextContext` |
| ¿Quién espera mi sector? | `buildWhoIsWaitingContext` |
| ¿Cuál es el cuello de botella? | `buildBottleneckContext` |

### Con automatizaciones

El registry declara `completesWhen`, `unblocks` y `producedEntities`. Automatizaciones futuras (F11+) escucharán cierre de etapa sin hardcodear reglas en React.

---

## 8. Cómo agregar una nueva etapa

1. Agregar `WorkflowStageId` en `types.ts` → `WORKFLOW_STAGE_IDS`.
2. Crear entrada en `workflow-registry.ts` con `defineWorkflowStage({ ... })`.
3. Si aplica, mapear en `workflow-engine.ts` (`SECTOR_TO_STAGE` / `ORIGIN_STAGE_TO_WORKFLOW`).
4. Actualizar `PRIMARY_WORKFLOW_CHAIN` si entra en la cadena principal.
5. **No** agregar lógica de flujo en componentes React.

---

## 9. Restricciones F9.4

- No se modificó backend, Drive, Discovery, Mappers, WorkItems.
- No se modificó Role Engine, design-preview ni app real.
- No hay pantallas nuevas ni funcionalidad visible.
- Capa puramente arquitectónica — lista para consumo en F10+.

---

## 10. Visión

Genus OS deja de ser una interfaz sobre planillas. El Workflow Engine es el **conocimiento operativo del laboratorio**: entiende dependencias, bloqueos, cuellos de botella y consecuencias de cada acción.

El Role Engine sigue siendo el responsable de **presentar** ese conocimiento de forma adecuada para cada puesto de trabajo.

Cuando Creamy AI esté integrada, responderá preguntas reales como:

- "¿Por qué este trabajo está detenido?"
- "¿Qué sucede cuando termine esta OA?"
- "¿Qué sector está esperando al mío?"
- "¿Cuál es el cuello de botella de hoy?"

…consultando este motor, no inventando respuestas.
