# 37 — Eliminaciones visibles, Creamy Gemini/OpenAI y guía operativa

## Resumen

Iteración sobre Preview (PR #60) que corrige tres frentes:

1. **Eliminación visible de trabajos asignados** (Producción).
2. **Borrar entrega desde la lista principal de Entregados**.
3. **Creamy con Gemini + OpenAI**, prompt propio de Genus OS, guía de la app, elaboración y reemplazos aprobados.

Sin merge a Production.

---

## 1. Borrar / cancelar trabajos asignados

### Dónde aparece

- **Asignar trabajos**: botón rojo con icono de papelera **Eliminar trabajo** / **Cancelar trabajo** en cada fila + menú ⋮.
- **Panel general (Producción)**: misma acción compacta en la columna Acción de trabajos activos.
- Solo **PRODUCCION** (`canMutateAssignedWork` / `gateWorkMutation`).

### Reglas

| Estado | Acción | Efecto |
|--------|--------|--------|
| Pendiente sin avances | Eliminar trabajo | Baja lógica (`meta.deleted`); sale de listas activas |
| Con avances / en curso / revisión | Cancelar trabajo | `status=cancelado` + motivo; sale de activas; queda en historial |
| Finalizado / entregado | No borrar como pendiente | Archivar o usar flujo de Entregados |

### Historial → pestaña “Cancelados y eliminados”

Muestra producto, cliente, sector, estado anterior, fecha, actor, motivo y tipo (eliminado/cancelado/archivado).

**Restaurar** (solo PRODUCCION) si no hay conflicto con otro trabajo activo similar.

### Manual vs planilla

- **Manual (localStorage):** `deleteOrCancelManualWorkItem` / `restoreManualWorkItem`.
- **Planilla:** overlay `cancelado` vía progress + Live Sync `cancel_work`. No borra Sheets ni OE/OA/Calidad/lotes.

---

## 2. Borrar entrega desde Entregados

Menú por fila: Ver detalle · Archivar · **Borrar entrega** · Anular.

Flujo guiado:

1. Explicación: se archiva antes de eliminar definitivo.
2. Opciones: Cancelar · Archivar solamente · Continuar para eliminar.
3. Motivo obligatorio.
4. Segunda confirmación irreversible.

Al confirmar: quita de Entregados/Archivados/Creamy; conserva stub `REGISTRO_ELIMINADO`; **no** borra trabajo, OE/OA, Calidad, lotes ni documentos.

### Diferencias claras

| Acción | Qué hace |
|--------|----------|
| Descartar notificación | Solo oculta el aviso |
| Archivar entrega | Oculta y permite restaurar |
| Borrar entrega | Elimina registro visible; no restaura |
| Eliminar/cancelar trabajo | Baja la asignación operativa |

---

## 3. Creamy — Gemini y OpenAI

Dependencias: `@ai-sdk/google`, `@ai-sdk/openai`, `ai`.

Módulo: `frontend/src/lib/assistant/creamy-provider.ts`

### Variables

```
CREAMY_AI_PROVIDER=gemini|openai|auto   # recomendado: gemini
CREAMY_AI_FALLBACK=true|false           # recomendado: true
GEMINI_API_KEY=
CREAMY_GEMINI_MODEL=gemini-2.0-flash
CREAMY_OPENAI_API_KEY=
OPENAI_API_KEY=                         # fallback de variable OpenAI
CREAMY_OPENAI_MODEL=gpt-4o-mini
```

### Selección

- `gemini` → exige `GEMINI_API_KEY` (sin salto silencioso a OpenAI).
- `openai` → `CREAMY_OPENAI_API_KEY` o `OPENAI_API_KEY`.
- `auto` / ausente → Gemini si hay key; si no, OpenAI; si no, 503.

### Fallback (`CREAMY_AI_FALLBACK=true`)

Una sola reintento al proveedor alternativo ante timeout / 429 / 5xx.
**No** ante 401/403 / clave inválida.
Avisa de forma discreta: “Respuesta generada con proveedor alternativo.”

`/api/v1/assistant/status` expone solo `{ configured, provider, model }` (nunca claves).

---

## 4. Personalidad Genus OS

`frontend/src/lib/assistant/creamy-system-prompt.ts`

Creamy = asistente operativo interno de Genus OS para Laboratorio Genus.
Español, claro, práctico, pasos numerados, solo lectura, no inventa datos ni sustituciones.

---

## 5. Guía de la app + Elaboración + reemplazos

- `getApplicationHelp` ampliado (entregas, eliminar trabajo, OE/OA, lotes, MP, etc.).
- Tools Elaboración: `getElaborationWork`, `getElaborationWorkByOperator`, fórmula/BOM, disponibilidad MP, observaciones previas, OE, `searchApprovedSubstitutions`.
- Reemplazos: `mp-substitutions-repository.ts` (@mock-temp localStorage). Sin reemplazo aprobado → mensaje explícito; nunca inventa equivalencias.

ELABORACION puede consultar works, OE, MP, lotes, sustituciones y help (solo lectura).

---

## 6. Persistencia real

| Dato | Persistencia |
|------|----------------|
| Trabajos manuales eliminar/cancelar/restaurar | localStorage |
| Cancelación planilla | overlay progress + Live Sync `cancel_work` (modo real) |
| Entregas | localStorage + Live Sync ops |
| Reemplazos MP | localStorage demo |
| Fórmulas | mock en código + snapshot |

Limitación: `actorSectorId` no es autenticación server-side completa.

---

## 7. Verificación

- `npm test`
- `npm run build`
- `npx tsc --noEmit` / `npm run lint` (solo errores preexistentes)
