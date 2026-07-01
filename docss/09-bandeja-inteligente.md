# 09 — Bandeja Inteligente de Trabajo

La evolución del "Centro de Operaciones": de **dashboard** (que se lee) a **Bandeja Inteligente** (que guía). Es la materialización del sistema asistente (`00`) y la pieza que unifica los Workspaces (`08`).

---

## 1. Qué es

Una superficie **personal y viva** que responde, para cada usuario, *"¿qué tengo que hacer ahora?"*. No es un tablero de métricas: es la cola de trabajo de la persona, calculada a partir del estado de todas las operaciones y priorizada.

Un dashboard responde *"¿cómo van las cosas?"*; la Bandeja Inteligente responde *"¿qué tengo que hacer?"*. Genus debe liderar con la segunda; el panorama numérico queda como vista secundaria para quien supervisa.

## 2. Filosofía

- **Personal:** cambia por completo según quién sos y tu rol.
- **Viva (stateful):** se reconfigura sola según el estado de las operaciones (calma vs. problema).
- **Priorizada:** lo más urgente, arriba, siempre.
- **Anticipatoria:** muestra los problemas antes de que se busquen y entrega el trabajo cuando es el turno.
- **Que se vacía:** refleja el progreso del día; trabajar la "gasta".
- **Con buen final:** cuando no queda nada, lo dice con orgullo (empty state positivo), no con vacío.

## 3. Estructura

- **El Foco** — *lo próximo*. Ocupa ~80% de la pantalla. Una cosa, con su acción.
- **Las Vías de contexto** — franjas secundarias: lo que espera a otro, lo que tiene problema, lo terminado.
- **El Pulso del día** — sensación sutil de avance (cuánto hiciste / cuánto falta).
- **La Posta** — el trabajo que entra porque alguien terminó su parte.

## 4. Prioridades

El orden lo calcula el sistema (el usuario no prioriza):
1. **Bloqueante / problema** (algo detenido o en riesgo).
2. **Compromiso / vencimiento próximo.**
3. **Antigüedad** (lo que más espera).
4. **Orden del plan.**

## 5. Cómo aparecen las tareas

- **Lo asignado** aparece en el foco según el plan y el rol.
- **La posta:** cuando una entidad cambia de estado, la tarea del paso siguiente aparece en la bandeja del rol responsable (ver matriz de transiciones en `05`).
- **Los problemas** (desvío, faltante, vencimiento, incidencia, rechazo) suben solos a "Problemas".

## 6. Cómo desaparecen

- Al **completar** la acción, la tarea sale del foco y la siguiente toma su lugar.
- Lo **entregado a otro** pasa a "Esperando a otros" (ya no es accionable por mí).
- Lo **terminado hoy** va a "Finalizados" (colapsado) y luego se archiva.
- Nada que ya no sirva permanece: el espacio se mantiene limpio.

## 7. Qué significa "Mi Trabajo"

"Mi Trabajo" es la vista unificada de **todo lo que me toca**, sin importar de qué entidad provenga (una OE, un lote, una liberación, un pedido). Hoy, sin la tabla `TAREAS`, "Mi Trabajo" se **aproxima** apilando las secciones por estado de cada Workspace. Con `TAREAS`, se vuelve una **única cola priorizada** que cruza todas las entidades.

## 8. Cómo se ordena / cómo prioriza

Cada ítem lleva (conceptualmente) un **puntaje de urgencia** derivado de los criterios de §4. La bandeja se ordena por ese puntaje descendente; el primero es el Foco. Dentro de cada sección, mismo criterio.

## 9. Conexión con la futura tabla `TAREAS`

`TAREAS` es la pieza de arquitectura que convierte la aproximación en un asistente real. Conceptualmente, una tarea es:

> **(entidad · estado · responsable · acción siguiente · contexto · urgencia · timestamps).**

Funcionamiento previsto:
- **Generación / mantenimiento por automatización:** cuando una entidad cambia de estado, una automatización **crea, reasigna o cierra** la tarea correspondiente (la posta). La tabla no se llena a mano.
- **Unificación:** todas las entidades alimentan una sola tabla `TAREAS`, lo que permite una **única bandeja priorizada por persona**.
- **Asignación por rol:** el responsable de cada tarea sale del RBAC (qué rol recibe cada posta).
- **Priorización:** el puntaje de urgencia se calcula y se mantiene como campo.
- **Notificaciones:** cada alta de tarea relevante puede disparar un aviso (push/Slack) — "te llegó algo".

`TAREAS` es la **gran apuesta** del roadmap (bucket C/D, fase posterior a los quick wins; ver `14` y `19`). No es lo primero que se construye —es plomería invisible— pero es lo que hace que Genus deje de ser una base de datos y sea un asistente. El diseño de su esquema y de sus automatizaciones es el principal trabajo pendiente de arquitectura.

---

## 10. Estado de implementación

- **Hoy (aproximable):** Workspaces con secciones por estado (slices) + acciones contextuales + KPIs de conteo.
- **Pendiente (la bandeja real):** tabla `TAREAS` + automatizaciones de la posta + notificaciones push + puntaje de urgencia computado.
- En un **front-end propio** (`15`/`17`), la Bandeja Inteligente es la pantalla central, alimentada por la API que expone `TAREAS`.
