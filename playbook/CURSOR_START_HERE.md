# CURSOR_START_HERE

### Leé esto antes de escribir una sola línea de código en Genus OS.

Este archivo no reemplaza nada — es el resumen mínimo indispensable para arrancar una tarea sin haber leído todavía el resto de `/playbook`. Si tenés tiempo, leé los cuatro documentos completos (ver [`README.md`](./README.md)). Si tenés que arrancar ya, esto alcanza para no romper nada importante.

---

## 1. Qué es Genus OS, en una frase

El sistema digital de operaciones de Laboratorio Genus (fabricante cosmético GMP bajo ANMAT). No es un ERP tradicional: es un **ERP guiado por tareas** — organiza todo por **Trabajo → Estado → Acción → Datos**, nunca al revés. La frase que resume el producto: *"Esto es lo próximo que tenés que hacer."*

Detalle completo: [`01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md`](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md).

## 2. Los principios que NUNCA se rompen

1. `MOVIMIENTOS` es append-only. Nunca `UPDATE`/`DELETE`.
2. `SALDOS` es derivado. Nunca se escribe a mano.
3. `LIBERACIONES` es append-only y es la única vía por la que cambia `LOTES.estado`.
4. Los estados se derivan, nunca se tipean.
5. La fórmula vive en `BOM`, versionada, y se congela (`bom_version`) en la OE/OA.
6. Dos barreras de liberación humanas: granel liberado antes de acondicionar, PT liberado antes de despachar.
7. Segregación de funciones: quien ejecuta/cierra una orden no firma su liberación.
8. RBAC default-deny, autorización del lado servidor — nunca solo en el cliente.
9. Todo cambio al modelo es aditivo.
10. El usuario no navega tablas para trabajar — tablas solo para consulta/auditoría.
11. El backend actual (Google Sheets + AppSheet) no se reemplaza.
12. Un significado = un color, siempre (5 tokens semánticos, nunca uno nuevo suelto).

Si una tarea implica romper alguno de estos, **se detiene y se pregunta** — no se avanza. Detalle y el porqué de cada uno: [`01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md` — Sección 8](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md#8-principios-no-negociables-consolidado-con-el-porqué-explícito).

## 3. El estado real del proyecto, hoy (no asumas)

- El adapter de datos activo puede ser `mock` o `drive` (`GENUS_DATA_MODE`). El modo `real` hoy es un **slice experimental de solo lectura** sobre 3 hojas críticas (`ASIGNACION DE LOTES 2026`, `PEDIDOS 2026`, `SEMANAS 2026`) — no producción completa.
- **Arquitectura de integración web (24 meses):** Sheets → Next.js API/adapters → Genus OS. Apps Script solo opcional para escrituras puntuales. Ver [`docss/29-sheets-integration-strategy.md`](../docss/29-sheets-integration-strategy.md).
- **Contrato de Sheets (oficial):** hojas, columnas, lectura/escritura, KPIs — aprobar antes del discovery DASHBOARD. Ver [`docss/30-sheets-contract.md`](../docss/30-sheets-contract.md).
- `MOVIMIENTOS`, `SALDOS`, `ANALISIS_CALIDAD` y `LIBERACIONES` **no están conectados** todavía al adapter real.
- El RBAC de gobierno (`ROLES`/`MODULOS`/`PERMISOS`) puede seguir en sandbox, no en el Sheet de producción — tratarlo como pendiente salvo evidencia clara en el código.
- No existe todavía una capa de API propia separada del frontend (`docss/17` es visión largo plazo) — las **Next.js API routes** en `/api/v1` son el BFF; ver `docss/29`.
- El Design System y los Workspaces (F7.1) están construidos y maduros en el código. La conexión de datos reales está bastante más atrasada que la experiencia visual.

Detalle completo (tabla de fidelidad entidad por entidad): [`03_GENUS_OS_CURSOR_PLAYBOOK.md` — Sección 5](./03_GENUS_OS_CURSOR_PLAYBOOK.md#5-auditoría-de-fidelidad--la-parte-nueva-de-este-playbook).

## 4. El proceso a seguir en cualquier tarea

```
Comprender → Analizar → Diseñar → Validar → Programar
```

Nunca al revés. "Diseñar" no es código: es poder describir sin ambigüedad qué trabajo resuelve, en qué estado de qué entidad, con qué componente del Design System, y qué alternativas se descartaron. Recién después de validar ese diseño contra los principios no negociables, se programa.

Detalle completo: [`04_GENUS_OS_EXECUTION_MANUAL.md` — Secciones 1 a 4](./04_GENUS_OS_EXECUTION_MANUAL.md#1-cómo-debe-comenzar-cualquier-tarea).

## 5. Antes de crear algo nuevo, buscá si ya existe

- Componentes UI → `frontend/src/components/ui/`, `components/cards/`, `components/patterns/`.
- Colores/íconos/tipografía → `frontend/src/lib/tokens/` (nunca un valor suelto fuera de acá).
- Estructura de navegación → `frontend/src/config/workspaces/` (vocabulario canónico: Ahora / En cola / Esperando aprobación / Esperando a otros / Problemas / Finalizados).
- Pipeline de acciones → `lib/actions/run-action-pipeline.ts`, `validate-action.ts`, `config/actions/registry.ts`.

Reutilizar > crear. Extender > reemplazar. Detalle: [`04_GENUS_OS_EXECUTION_MANUAL.md` — Sección 5](./04_GENUS_OS_EXECUTION_MANUAL.md#5-cómo-debe-reutilizar).

## 6. Qué nunca hacer (lo más grave, resumido)

- Editar o borrar una fila de `MOVIMIENTOS` o `LIBERACIONES`.
- Escribir directamente en `SALDOS`.
- Crear un campo de estado manual paralelo a uno derivado.
- Confiar en que ocultar un botón en la UI alcanza como autorización.
- Asumir que una tabla `[DISEÑADA]`/`[PROPUESTA]` de `docss/03` ya existe conectada en producción.
- Inventar el alcance de un módulo futuro (Creamy, Comunicación, Procedimientos, Capacitaciones) sin confirmarlo antes.
- Introducir un color o componente fuera del Design System, "solo por esta vez".
- Mostrar más de una acción primaria en una misma pantalla.

Lista completa y el motivo de cada una: [`04_GENUS_OS_EXECUTION_MANUAL.md` — Sección 11](./04_GENUS_OS_EXECUTION_MANUAL.md#11-qué-nunca-debe-hacer).

## 7. Ante la duda

Preguntá antes de asumir — especialmente si la tarea toca algo regulatorio, RBAC, o un módulo futuro sin alcance confirmado. Una pregunta bien hecha (que muestra que ya se investigó, ofrece una interpretación tentativa, y llega en el momento justo) vale más que avanzar sobre una suposición. Detalle: [`04_GENUS_OS_EXECUTION_MANUAL.md` — Sección 14](./04_GENUS_OS_EXECUTION_MANUAL.md#14-cómo-debe-trabajar-conmigo-con-agustina).

## 8. Formato de entrega esperado

Toda entrega no trivial se presenta con: qué se resolvió, decisiones tomadas y por qué, componentes reutilizados, documentos consultados, principios aplicados, riesgos detectados, qué quedó pendiente. Plantilla completa: [`04_GENUS_OS_EXECUTION_MANUAL.md` — Sección 10](./04_GENUS_OS_EXECUTION_MANUAL.md#10-cómo-debe-entregar-una-implementación--formato-estándar).

---

*Este archivo es un resumen operativo. Para el razonamiento completo detrás de cada punto, seguí los enlaces a los cuatro documentos de [`/playbook`](./README.md).*
