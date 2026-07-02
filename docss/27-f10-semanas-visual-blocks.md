# 27 — F10.1 Interpretación visual de SEMANAS 2026

> **Estado:** Mapper F10.1 — bloques visuales, no filas planas  
> **Objetivo:** Genus OS lee SEMANAS como lo hace una persona del laboratorio

---

## Problema

El mapper F8.1 interpretaba SEMANAS como tabla: una fila = un WorkItem.

La planilla real está organizada en **bloques visuales**:

- **Elaboración:** bloques por elaborador (CRISTIAN, NICOLÁS…)
- **Envasado:** bloques por línea (LÍNEA 1, LÍNEA 2, LÍNEA 3 / PREMIUM A, B)

---

## Solución F10.1

### Nuevo campo WorkItem

| Campo | Descripción |
|-------|-------------|
| `ownerPerson` | Elaborador del bloque visual (ej. `"Cristian"`) |
| `ownerSector` | Sector operativo (sin cambio) |
| `line` | Línea de envasado normalizada (`LÍNEA 1`, `PREMIUM A`, etc.) |

### Parser visual (`semanas-block-parser.ts`)

- `detectElaboradorLabel()` — filas tipo CRISTIAN / NICOLÁS
- `detectLineLabel()` — LÍNEA 1/2/3, PREMIUM A/B
- `detectPackagingTier()` — masivo vs premium
- `SemanasVisualContext` — estado acumulado al recorrer el bloque

### Mapper (`semanas-to-work-items.ts`)

Recorre cada bloque con máquina de estados:

```text
ELABORACIÓN
  CRISTIAN          → ctx.elaborador = "Cristian"
    Producto A      → WorkItem { ownerPerson: "Cristian", sector: ELABORACION }
    Producto B
  NICOLÁS
    Producto C      → WorkItem { ownerPerson: "Nicolás", ... }

ACONDICIONAMIENTO MASIVO
  LÍNEA 1           → ctx.lineLabel = "LÍNEA 1"
    Cliente X       → WorkItem { line: "LÍNEA 1", sector: ENVASADO_MASIVO }
```

### API

`GET /api/v1/work-items?sector=ELABORACION&ownerPerson=Cristian`

Filtra por sector + persona — React **no agrupa**.

### Preview F10.1 (`/design-preview`)

Login enfocado en validación real:

| Entrada | Vista |
|---------|-------|
| cristian@… | Hola Cristian · lista de productos del bloque |
| nicolas@… | Hola Nicolás · sus productos |
| Envasado Masivo | LÍNEA 1 / 2 / 3 |
| Envasado Premium | Líneas premium reales |
| Producción | Planta agregada (WorkItems ya organizados) |

Campos ausentes → **"Dato no disponible"** (`display-fields.ts`).

### Fixture

`lib/mappers/__fixtures__/semanas-visual.fixture.ts` — estructura de referencia para validación manual.

---

## Reglas

1. **Nunca inventar datos** — si no está en SEMANAS, mostrar "Dato no disponible"
2. **No reagrupar en React** — el mapper entrega `ownerPerson` y `line` listos
3. **Producción consume WorkItems** — `buildProductionOverview()` no re-parsea la planilla

---

## Verificación

- `npm run lint` ✅
- `npm run build` ✅
- Preview con `GENUS_DATA_MODE=real` + Drive indexado
