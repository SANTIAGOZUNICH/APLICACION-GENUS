# GENUS_OS_EXECUTION_MANUAL
### Manual Oficial de Ejecución — cómo trabajar dentro de Genus OS

> Este documento asume que ya leíste [`01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md`](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md) y [`02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md`](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md) y, si hace falta el detalle exacto de algo, `docss/` y [`03_GENUS_OS_CURSOR_PLAYBOOK.md`](./03_GENUS_OS_CURSOR_PLAYBOOK.md). Ahí está el qué, el por qué y el criterio. Acá está el cómo — el procedimiento concreto que convierte ese criterio en trabajo entregado, tarea por tarea, de forma repetible.
>
> La prueba de que este manual funciona: dos instancias distintas de Cursor (o de cualquier IA, o de cualquier desarrollador nuevo), leyendo el mismo pedido y este mismo manual, deberían llegar a decisiones prácticamente iguales — mismo análisis, mismo criterio de decisión, mismo nivel de cuidado en la entrega. Si dos lecturas de este manual producen resultados muy distintos ante la misma tarea, el manual todavía tiene un hueco que hay que cerrar.

---

## Índice

- [1. Cómo debe comenzar cualquier tarea](#1-cómo-debe-comenzar-cualquier-tarea)
- [2. Cómo debe analizar una solicitud](#2-cómo-debe-analizar-una-solicitud)
- [3. Cómo debe tomar decisiones](#3-cómo-debe-tomar-decisiones)
- [4. Cómo debe desarrollar — el proceso, etapa por etapa](#4-cómo-debe-desarrollar--el-proceso-etapa-por-etapa)
- [5. Cómo debe reutilizar](#5-cómo-debe-reutilizar)
- [6. Cómo debe trabajar con `docss/`](#6-cómo-debe-trabajar-con-docss)
- [7. Cómo debe trabajar con el frontend](#7-cómo-debe-trabajar-con-el-frontend)
- [8. Cómo debe trabajar con el backend](#8-cómo-debe-trabajar-con-el-backend)
- [9. Cómo debe revisar su propio trabajo antes de dar una tarea por terminada](#9-cómo-debe-revisar-su-propio-trabajo-antes-de-dar-una-tarea-por-terminada)
- [10. Cómo debe entregar una implementación — formato estándar](#10-cómo-debe-entregar-una-implementación--formato-estándar)
- [11. Qué nunca debe hacer](#11-qué-nunca-debe-hacer)
- [12. Cómo debe evolucionar el proyecto](#12-cómo-debe-evolucionar-el-proyecto)
- [13. Framework de autoevaluación — antes de finalizar cualquier tarea](#13-framework-de-autoevaluación--antes-de-finalizar-cualquier-tarea)
- [14. Cómo debe trabajar conmigo (con Agustina)](#14-cómo-debe-trabajar-conmigo-con-agustina)

---

## 1. Cómo debe comenzar cualquier tarea

Antes de escribir una sola línea de código, sin excepción, este es el orden:

1. **Leer el pedido dos veces.** La primera para entender qué se pide literalmente. La segunda para identificar qué *trabajo real* hay detrás del pedido (ver Sección 2) — casi nunca son exactamente lo mismo.
2. **Identificar la parte del proyecto involucrada.** ¿Es una pantalla nueva, una modificación de flujo, un cambio de modelo de datos, una integración con Sheets/Drive, una corrección de un componente existente? Esto determina qué documentos leer a continuación.
3. **Leer los documentos relevantes a esa parte, en este orden de prioridad:**
   - [`01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md`](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md) y [`02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md`](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md) — siempre, aunque sea repasar mentalmente, porque ahí vive el criterio con el que se va a evaluar todo lo demás.
   - [`03_GENUS_OS_CURSOR_PLAYBOOK.md`](./03_GENUS_OS_CURSOR_PLAYBOOK.md), especialmente la Sección 5 (auditoría de fidelidad) — para saber qué de lo documentado ya es real y qué sigue siendo blueprint.
   - El/los documento(s) específicos de `docss/` que tocan el dominio de la tarea (por ejemplo, si la tarea toca RBAC, `docss/04`; si toca una pantalla nueva, `docss/07` y `docss/08`).
   - El código actual del área específica que se va a tocar — nunca asumir cómo está hecho algo sin haberlo leído.
4. **Entender el contexto operativo real**, no solo el documentado: si la tarea toca una entidad que en `docss/03` está marcada `[DISEÑADA]` o `[PROPUESTA]`, verificar en el código (adapters, mappers) si ya está conectada a datos reales o sigue siendo mock — no asumir fidelidad.
5. **Detectar dependencias.** ¿Esta tarea depende de que otra cosa exista primero (una tabla, un adapter, un componente del Design System)? Si esa dependencia no está resuelta, la tarea no está lista para empezar — hay que decirlo explícitamente en vez de improvisar un sustituto temporal que después alguien va a tener que recordar deshacer.
6. **Identificar restricciones aplicables.** ¿Esta tarea toca alguno de los principios no negociables ([Sección 8 de la Parte I](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md#8-principios-no-negociables-consolidado-con-el-porqué-explícito))? Listarlos explícitamente antes de diseñar la solución, no después.
7. **Identificar qué principios de experiencia ([Sección 13 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#13-principios-de-experiencia--la-personalidad-del-producto)) están en juego.** ¿A qué rol le habla esta tarea? ¿Qué sensación debería producir ([Sección 12](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#12-cómo-debe-sentirse-genus-os))?

Solo después de completar estos siete pasos, se pasa a la Sección 2 (análisis de la solicitud) o directamente a diseñar, según qué tan clara haya quedado la tarea.

---

## 2. Cómo debe analizar una solicitud

### 2.1 El primer movimiento: separar el pedido literal del trabajo real

Cuando Agustina (o quien lidere el producto) pide algo, el pedido suele venir formulado como una solución ("agreguemos un botón para que Calidad pueda...") en vez de como un problema ("Calidad hoy tarda en encontrar la evidencia de un lote"). El primer trabajo de análisis es extraer el problema real detrás de la solución propuesta, aplicando el mismo movimiento de la [Sección 15.1 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#151-el-origen-de-una-necesidad-real-vs-una-necesidad-inventada): nombrar el trabajo, no la funcionalidad.

Esto no es cuestionar por sistema — es entender antes de ejecutar. Muchas veces el problema real, una vez nombrado, revela que la solución propuesta es exactamente la correcta; a veces revela que hay una mejor, más simple o más coherente con lo que ya existe.

### 2.2 Preguntas que hacerse ante cualquier solicitud

1. ¿Qué persona, en qué rol, sufre la fricción que esto resuelve?
2. ¿En qué momento del flujo aparece esa fricción — antes, durante o después de alguna transición de estado?
3. ¿Esto ya se resuelve, parcial o totalmente, con algo que existe hoy?
4. ¿La solución propuesta por Agustina es la única forma de resolverlo, o es una entre varias — y si hay varias, se evaluaron con el framework de la [Sección 16 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#16-framework-de-toma-de-decisiones)?
5. ¿Qué asume esta solicitud sobre el estado actual del sistema, y esa suposición es verificable en el código real?
6. ¿Esta solicitud es puntual, o es la punta de un patrón que se va a repetir (y por lo tanto merece resolverse como pieza reutilizable del Design System en vez de como parche puntual)?

### 2.3 Qué información buscar antes de responder

- El estado real del área del sistema que la solicitud toca (código, no solo documentación).
- Si existe una pantalla o flujo parecido en otro Workspace que ya resolvió un problema similar — reutilizar antes que inventar.
- Si la solicitud toca una entidad marcada `[DISEÑADA]`/`[PROPUESTA]` en `docss/03`, verificar si ya está conectada de verdad o si construir esto primero requeriría resolver esa conexión.

### 2.4 Qué nunca debe asumirse

- Que una tabla o campo mencionado en `docss/` ya existe en el Sheet de producción.
- Que el adapter de datos activo es el `real` y no el `mock`, sin verificarlo.
- Que "es un cambio chico" solo porque el pedido suena chico — el tamaño real de un cambio se mide por cuántos principios no negociables toca, no por cuántas líneas de código requiere.
- Que Agustina ya evaluó todas las alternativas — puede haber llegado a la solución propuesta rápido, sin haber tenido tiempo de comparar opciones; parte del trabajo de quien ejecuta es, respetuosamente, ofrecer esa comparación si hace falta (ver Sección 14).
- Que porque algo funciona en el mock, va a funcionar igual con datos reales — el mock por diseño es más limpio y regular que la realidad operativa (ver la auditoría de fidelidad del Playbook).

### 2.5 Cómo detectar si la solicitud contradice la filosofía

Se aplica directamente el checklist de la [Sección 9 de la Parte I](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md#9-checklist-de-toma-de-decisiones--antes-de-implementar-cualquier-cambio) y el framework de evaluación de la [Sección 19 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#19-cómo-evaluar-una-propuesta--framework-de-evaluación). Señales concretas de contradicción a las que prestar atención especial en una solicitud:

- Pide que alguien pueda editar algo que hoy es derivado o append-only ("che, ¿no podemos hacer que se pueda corregir directo el saldo si nos equivocamos?").
- Pide mostrar "todo" en una pantalla, en vez de lo priorizado ("que se vea toda la info de una").
- Pide una excepción puntual a la segregación de funciones ("que en este caso el supervisor también pueda firmar, para no trabar el proceso").
- Pide un color o componente nuevo "solo para este caso".

Cuando aparece una de estas señales, la respuesta correcta no es rechazar el pedido en silencio ni ejecutarlo tal cual — es señalar explícitamente la tensión (ver Sección 14) y proponer la alternativa que resuelve el mismo problema real sin romper el principio.

---

## 3. Cómo debe tomar decisiones

Se aplica en su totalidad el **Framework de toma de decisiones** de la [Sección 16 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#16-framework-de-toma-de-decisiones) (Capa 0: no negociables, como filtro de veto; Capa 1: impacto en la persona real; Capa 2: coherencia con lo existente; Capa 3: reversibilidad; Capa 4: costo y velocidad, solo al final).

### 3.1 Cómo justificar la decisión, en la práctica

Toda decisión de implementación relevante debe poder resumirse en la fórmula ya definida en la Parte II: *"Elegí [solución] en vez de [alternativa] porque [alternativa] arriesgaba [principio], y [solución] resuelve [trabajo real] reutilizando [vocabulario existente], con el trade-off explícito de [costo aceptado]."* Esta fórmula no es un ejercicio retórico — es lo que se incluye después en el formato de entrega (Sección 10).

### 3.2 Cómo detectar una solución mediocre

Una solución mediocre generalmente comparte alguna de estas señales:

- Resuelve el síntoma pero no el trabajo real (por ejemplo, agrega un mensaje de error más claro a un flujo que en realidad no debería permitir llegar a ese error en primer lugar).
- Funciona en el caso feliz pero no se pensó el caso de error, el caso vacío o el caso de permisos denegados.
- Introduce una excepción "solo por ahora" sin plan de resolverla.
- Se puede describir solo en términos de implementación técnica, no en el lenguaje de trabajo/tarea del usuario (ver [Sección 3.4 de la Parte I](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md#3-cómo-pensar-genus-os--el-proceso-mental-no-solo-las-reglas)).
- Duplica algo que ya existe con una variación menor, en vez de extender lo existente.

### 3.3 Cómo detectar una excelente solución

Una excelente solución, en este proyecto específicamente, generalmente:

- Reduce, no aumenta, la cantidad de decisiones que la persona final tiene que tomar.
- Se integra al vocabulario existente tan bien que, mirándola, no es obvio que es "nueva" — se siente como si siempre hubiera estado ahí.
- Resuelve el problema real identificado en el análisis (Sección 2), no solo el síntoma reportado.
- Es explicable en una frase corta usando el lenguaje de trabajo/estado/acción.
- No necesita una excepción a ningún principio no negociable para funcionar.

---

## 4. Cómo debe desarrollar — el proceso, etapa por etapa

```
Comprender → Analizar → Diseñar → Validar → Programar
```

**Nunca al revés.** Empezar a programar antes de terminar las cuatro etapas anteriores es la causa más común de retrabajo en este tipo de proyecto — porque el costo de deshacer una decisión de diseño después de programada es mucho mayor que el costo de haberla pensado bien antes.

### 4.1 Comprender

Corresponde a la Sección 1 de este manual. Se completa cuando se puede repetir el pedido con las propias palabras, incluyendo el trabajo real detrás de él, sin volver a mirar el pedido original.

### 4.2 Analizar

Corresponde a la Sección 2. Se completa cuando están respondidas las preguntas de 2.2, identificada la información de 2.3, y descartadas explícitamente las suposiciones prohibidas de 2.4.

### 4.3 Diseñar

Acá se aplica todo lo de las Secciones [14](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#14-cómo-pensar-una-pantalla-nueva--el-proceso-mental-completo) y [15](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#15-cómo-pensar-una-funcionalidad-nueva--de-la-necesidad-a-la-implementación) de la Parte II (cómo pensar una pantalla nueva / una funcionalidad nueva) y el Framework de la [Sección 16](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#16-framework-de-toma-de-decisiones). El resultado de esta etapa **no es código** — es una descripción clara de: qué trabajo resuelve, en qué estado de qué entidad aplica, qué componentes del Design System reutiliza, qué principios toca y cómo los respeta, y qué alternativas se descartaron y por qué.

Esta etapa se completa cuando esa descripción se puede escribir sin ambigüedad. Si todavía hace falta "ver cómo queda" programando para decidir, es señal de que el diseño no está terminado — no de que ya es momento de programar.

### 4.4 Validar

Antes de tocar código, correr el diseño (no el código) contra:

- El checklist de la [Sección 9 de la Parte I](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md#9-checklist-de-toma-de-decisiones--antes-de-implementar-cualquier-cambio) (los 10 puntos).
- El framework de evaluación de la [Sección 19 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#19-cómo-evaluar-una-propuesta--framework-de-evaluación).
- Los principios no negociables de la [Sección 8 de la Parte I](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md#8-principios-no-negociables-consolidado-con-el-porqué-explícito), uno por uno.

Si el diseño no pasa alguno de estos filtros, se vuelve a la etapa de Diseñar — nunca se avanza "total, después se ajusta en el código".

### 4.5 Programar

Recién acá se escribe código, aplicando la filosofía de desarrollo completa de la [Sección 18 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#18-cómo-escribir-código-para-genus-os--filosofía-de-desarrollo) (reutilizar > crear, extender > reemplazar, evolucionar > reescribir, simplicidad > sofisticación, claridad > abstracción). Programar, en este proceso, debería sentirse como *traducir* una decisión ya tomada, no como *tomar* la decisión mientras se escribe.

---

## 5. Cómo debe reutilizar

### 5.1 Cómo buscar componentes existentes

Antes de crear cualquier componente de UI, revisar en orden: `frontend/src/components/ui/` (primitivas), `frontend/src/components/cards/` (cards de entidad ya construidas: OE, OA, lote, liberación, pedido), `frontend/src/components/patterns/` (patrones compuestos: entity-page, workspace, bandeja, actions), y la referencia visual en `/design-system` (`docss/07`). Si algo parecido existe, la pregunta no es "¿me sirve tal cual?" sino "¿puedo extenderlo para que me sirva?" antes de descartarlo.

### 5.2 Cómo buscar patrones

Los patrones de este proyecto no son solo componentes — son estructuras repetidas: la gramática de card (`docss/07` §4), el vocabulario de secciones de Workspace (`docss/08` §2), el pipeline de acciones (`lib/actions/run-action-pipeline.ts`, `validate-action.ts`). Cualquier funcionalidad nueva que "se sienta parecida" a algo que ya existe casi seguro puede expresarse reutilizando uno de estos patrones en vez de inventar una estructura nueva.

### 5.3 Cómo detectar duplicaciones

Señal de alerta: escribir un componente o handler nuevo y notar, a mitad de camino, que se está repitiendo una lógica de validación, un cálculo de estado, o una estructura visual que ya existe en otro archivo. Cuando eso pasa, detenerse y extraer/reutilizar en vez de terminar la copia — el momento de menor costo para evitar una duplicación es el momento en que se la nota, no "después, cuando haya tiempo de refactorizar".

### 5.4 Cómo extender en lugar de reemplazar

Extender significa: agregar una capacidad nueva a algo existente sin alterar el comportamiento de los casos que ya funcionaban. Antes de modificar un componente o función existente, verificar explícitamente qué otros lugares del código lo usan (buscar todas las referencias), y confirmar que el cambio no les cambia el comportamiento de forma no intencional. Si el cambio necesario es tan grande que "extender" ya no describe bien lo que hay que hacer, es momento de pausar y plantear explícitamente que se trata de un reemplazo — nunca disfrazarlo de extensión.

### 5.5 Cómo mantener consistencia

La consistencia no se mantiene revisando al final si "quedó parecido" — se mantiene partiendo siempre del vocabulario existente (tokens, gramática de card, secciones canónicas de Workspace, convenciones de `docss/18`) como punto de partida obligatorio del diseño, no como una revisión posterior.

---

## 6. Cómo debe trabajar con `docss/`

### 6.1 Cómo interpretar cada documento

Cada documento de `docss/` tiene un propósito específico (ver el índice de `docss/README.md`) y una marca de fidelidad implícita en su contenido (`[VERIFICADA]`, `[DISEÑADA]`, `[PROPUESTA]`, o "MÓDULO FUTURO PROPUESTO" para los capítulos 10–13). Interpretar correctamente un documento significa, además de leer su contenido, notar esa marca y tratarla con el peso que corresponde: lo `[VERIFICADA]` es un hecho del sistema, no una opción de diseño abierta a discusión; lo `[PROPUESTA]` o "módulo futuro" es dirección, no especificación cerrada.

### 6.2 Cuándo usarlo

Siempre que la tarea toque un área que `docss/` documenta — es decir, casi siempre. La única excepción legítima es una tarea puramente cosmética que no toca modelo de datos, flujo, RBAC ni Design System (por ejemplo, un ajuste de copy). Incluso ahí, `docss/18` (convenciones de lenguaje) sigue siendo relevante.

### 6.3 Cómo respetarlo

Respetar `docss/` no significa citarlo literalmente en cada decisión — significa que ninguna decisión de implementación debería contradecirlo sin que esa contradicción quede señalada explícitamente y, si corresponde, se proponga actualizar el documento (nunca dejarlo desactualizado en silencio mientras el código avanza en otra dirección).

### 6.4 Cómo detectar contradicciones

Una contradicción aparece cuando dos documentos de `docss/` (o un documento y el código real) describen el mismo concepto de forma incompatible — no cuando simplemente uno tiene más detalle que otro. Ante una sospecha de contradicción, el primer paso es releer ambas fuentes con cuidado: muchas veces lo que parece contradicción es en realidad una diferencia de nivel de fidelidad (uno describe la visión, otro el estado actual), que no es una contradicción real sino exactamente lo que la auditoría de fidelidad del Playbook ya documenta.

### 6.5 Qué hacer si encuentra diferencias entre código y documentación

No resolver la diferencia por cuenta propia asumiendo cuál de las dos fuentes tiene razón. El procedimiento correcto:

1. Documentar la diferencia con precisión (qué dice `docss/`, qué hace el código, con referencia a archivo/línea).
2. Verificar si la diferencia ya está registrada en la auditoría de fidelidad del Playbook — si no, es información nueva que vale la pena agregar ahí.
3. Si la tarea actual depende de resolver esa diferencia, señalarlo explícitamente a Agustina antes de avanzar, en vez de elegir una interpretación en silencio.

### 6.6 Cómo actuar si encuentra un vacío documental

Si una tarea requiere una decisión que ningún documento cubre (por ejemplo, un caso borde de UX que `docss/07` no contempla), no improvisar una decisión definitiva por cuenta propia si la decisión es de alto impacto o difícil de revertir. Proponer una opción razonable, aplicando el criterio de las Partes I y II, mostrar el razonamiento, y dejar la validación final a Agustina — especialmente si el vacío toca algo con implicancia regulatoria. Si el vacío es de bajo impacto y fácilmente reversible, se puede decidir y avanzar, documentando la decisión para que quede registrada (no perdida en el historial de commits sin explicación).

---

## 7. Cómo debe trabajar con el frontend

### 7.1 Cómo respetar el Design System

Nunca usar un color, ícono, tamaño de tipografía o espaciado que no esté ya definido en `docss/07` y en `frontend/src/lib/tokens/` (`colors.ts`, `typography.ts`, `icons.ts`, `status-map.ts`). Si una necesidad visual nueva no encaja en el sistema existente, el paso correcto es proponer formalmente extender el sistema — nunca resolverlo con un valor suelto en una pantalla puntual.

### 7.2 Cómo respetar los Workspaces

Toda pantalla nueva de trabajo debe encajar dentro de la estructura de Workspace-por-misión ya existente (`frontend/src/config/workspaces/`), usando el vocabulario canónico de secciones (Ahora / En cola / Esperando aprobación / Esperando a otros / Problemas / Finalizados) definido en `docss/08` §2. No crear una sección nueva con nombre propio sin verificar primero si alguna de las seis canónicas ya la cubre.

### 7.3 Cómo respetar la Bandeja Inteligente

Hoy la Bandeja es una aproximación (secciones por estado apiladas), no la versión unificada final que depende de la futura tabla `TAREAS`. Cualquier trabajo sobre la Bandeja debe respetar ese estado de madurez real — no construir asumiendo que `TAREAS` ya existe si no está confirmado en el código.

### 7.4 Cómo respetar la gramática de cards

Toda card nueva de trabajo sigue la estructura fija: identidad/título · badge de estado · metadatos · urgencia · una acción primaria (`docss/07` §4). Revisar `frontend/src/components/cards/` antes de crear una card nueva — probablemente el patrón base ya existe y solo hace falta una variante.

### 7.5 Cómo mantener consistencia visual

Antes de dar por terminada cualquier pantalla, compararla mentalmente contra una ya existente del mismo tipo (por ejemplo, comparar una card de OA nueva contra la card de OE ya construida): mismo peso tipográfico en los mismos lugares, mismo uso de color, mismo patrón de acción.

### 7.6 Cómo mantener consistencia funcional

Toda acción nueva debe pasar por el mismo pipeline existente (`lib/actions/run-action-pipeline.ts`, `validate-action.ts`, `config/actions/registry.ts`) en vez de implementar su propio flujo de ejecución/validación por separado. Esto es lo que garantiza que RBAC, confirmación y feedback se comporten igual en toda la app.

---

## 8. Cómo debe trabajar con el backend

### 8.1 Cómo respetar Google Sheets

Las tablas y fórmulas existentes (particularmente `MOVIMIENTOS.cantidad_signo`, `SALDOS.cantidad_actual`, los cumplimientos derivados de `PEDIDOS_DET`) no se modifican salvo justificación explícita y validada. Cualquier columna nueva se agrega al final, nunca insertada en medio de las existentes.

### 8.2 Cómo respetar AppSheet

AppSheet sigue siendo la capa de aplicación y RBAC del backend actual (`docss/16`). No se reimplementan en el frontend nuevo las reglas de negocio que ya viven ahí — se leen y respetan desde el frontend, no se duplican.

### 8.3 Cómo respetar los adapters

Los adapters (`mockAdapter`, `driveAdapter`) deben mantenerse intercambiables y ninguna pantalla debe asumir cuál está activo. Al extender un mapper (por ejemplo, `lote-asignacion.mapper.ts`), seguir el patrón ya establecido de tolerancia a variación de columnas (`pickField` con múltiples alias) en vez de asumir un formato rígido — la realidad operativa de los Sheets es irregular, y el código ya asume eso correctamente; no hay que "corregir" esa tolerancia pensando que es descuido.

### 8.4 Qué nunca debe modificar

- Las fórmulas de `MOVIMIENTOS`/`SALDOS`/cumplimientos derivados.
- La estructura `[VERIFICADA]` de `LOTES`, `MOVIMIENTOS`, `SALDOS`, `USUARIOS`, `ROLES`, `MODULOS`, `PERMISOS`.
- El comportamiento de append-only en cualquier tabla que ya lo tenga.
- La matriz de permisos, salvo a través del proceso formal de cambio (una fila nueva o modificada, nunca lógica hardcodeada que la reemplace).

### 8.5 Cómo pensar futuras APIs sin romper el presente

Cuando una tarea empiece a acercarse a la necesidad de una capa de API real (`docss/17`), diseñarla de forma que los contratos (forma de los datos, autorización) puedan implementarse primero *encima* del adapter actual sin exigir que Sheets/AppSheet cambien de comportamiento — la migración, si llega a pasar, debe poder hacerse "detrás" de la API sin que el frontend note la diferencia, tal como ya lo anticipa `docss/17` §7.

---

## 9. Cómo debe revisar su propio trabajo antes de dar una tarea por terminada

Checklist obligatorio, en orden:

1. **¿El diseño pasó las etapas de Comprender → Analizar → Diseñar → Validar antes de programar?** Si se saltó algún paso, volver atrás, no completar el checklist retroactivamente.
2. **¿Se verificaron los principios no negociables uno por uno**, explícitamente, no de memoria?
3. **¿Se reutilizó todo lo que se pudo reutilizar** (componentes, patrones, mappers) antes de crear algo nuevo?
4. **¿La solución es aditiva?** Si no, ¿está justificado y confirmado con Agustina?
5. **¿Se probó el caso feliz, el caso de error, el caso vacío y el caso de permiso denegado?** No alcanza con probar que "funciona" en el escenario ideal.
6. **¿Se probó con datos reales (o al menos con la irregularidad que los datos reales tienen), no solo con el mock limpio?**
7. **¿La UI resultante pasa el test de tres segundos** de la [Sección 14.4 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#144-cómo-saber-si-una-pantalla-está-bien-diseñada)?
8. **¿Quedó algo hardcodeado que debería vivir en una tabla de parámetros o en la matriz de permisos?**
9. **¿Se documentaron las decisiones de diseño y las alternativas descartadas**, no solo el resultado final?
10. **¿Esta implementación se podría explicar completa, en el formato de la Sección 10, sin tener que volver a revisar el código para recordar qué se hizo y por qué?**

---

## 10. Cómo debe entregar una implementación — formato estándar

Toda entrega relevante (no una corrección trivial de una línea) se presenta con esta estructura:

```
## Qué se resolvió
[El trabajo real, en una frase — no la lista de archivos tocados.]

## Decisiones tomadas y por qué
[Aplicando la fórmula de la Sección 3.1: solución elegida vs. alternativa(s)
descartada(s), qué principio motivó la elección.]

## Componentes/patrones reutilizados
[Qué ya existente se usó, en vez de crearse de nuevo.]

## Documentos consultados
[docss/xx, Playbook, Foundational Knowledge — qué se leyó para esta tarea
específica.]

## Principios aplicados
[Cuáles de los no negociables (Sección 8, Parte I) son relevantes acá y
cómo se respetaron.]

## Riesgos detectados
[Cualquier tensión, deuda técnica aceptada conscientemente, o dependencia
de algo que todavía no está resuelto (por ejemplo, "esto asume que
GENUS_DATA_MODE=real ya tiene MOVIMIENTOS conectado, lo cual hoy no es
así").]

## Qué quedó pendiente
[Explícitamente, no implícito — qué no se resolvió y por qué (fuera de
alcance, depende de otra pieza, requiere validación de Agustina/DT, etc.)]
```

Ninguna entrega se considera completa sin esta estructura, aunque sea breve — la brevedad está bien si la tarea era chica; la ausencia de alguna de las secciones no.

---

## 11. Qué nunca debe hacer

Lista extendida, con el motivo detrás de cada una:

- **Editar o borrar una fila de `MOVIMIENTOS` o `LIBERACIONES`, en ningún contexto, ni siquiera "de prueba" en un entorno que después se sincroniza con producción.** Es la garantía de trazabilidad completa; no hay caso que la justifique.
- **Escribir directamente en `SALDOS`.** Rompe la garantía de que el saldo mostrado siempre coincide con la realidad de movimientos.
- **Crear un campo de estado manual paralelo a uno derivado**, "para ir más rápido". Reintroduce doble fuente de verdad.
- **Confiar en la ocultación de UI como mecanismo de autorización real.** Un botón oculto no es seguridad; es solo una ayuda de experiencia. La autorización real vive (o debe vivir, cuando exista la API) del lado servidor.
- **Asumir que una tabla `[DISEÑADA]`/`[PROPUESTA]` de `docss/03` ya existe conectada en producción**, sin verificarlo en el código.
- **Inventar el alcance de un módulo futuro** (Creamy, Comunicación, Procedimientos, Capacitaciones) sin confirmarlo con Dirección Técnica/Calidad primero.
- **Introducir un color, ícono o componente visual fuera del sistema existente**, aunque sea "solo por esta vez".
- **Mostrar más de una acción primaria en una misma pantalla.**
- **Construir una pantalla que obligue a leer una tabla para saber qué hacer.**
- **Reescribir algo que funciona "porque se puede hacer mejor"**, sin justificación explícita de por qué la reescritura es necesaria y no solo preferible estéticamente.
- **Modificar una tabla `[VERIFICADA]` de forma no aditiva** (reordenar columnas, cambiar tipos, borrar campos).
- **Duplicar un componente o handler existente** con una variación menor en vez de extenderlo.
- **Dejar una decisión de diseño de alto impacto sin documentar**, confiando en que "se entiende mirando el código".
- **Avanzar sobre una ambigüedad regulatoria o de alcance sin preguntar**, asumiendo la interpretación que parezca más razonable.
- **Entregar una implementación sin haber probado el caso de error y el caso vacío**, solo el camino feliz.
- **Priorizar la velocidad de entrega por sobre cualquiera de los principios no negociables** — la Capa 4 del framework de decisión ([Sección 16, Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#16-framework-de-toma-de-decisiones)) existe exactamente para evitar esto.

---

## 12. Cómo debe evolucionar el proyecto

### 12.1 Cómo agregar nuevas funcionalidades

Siguiendo el proceso completo de la [Sección 15 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#15-cómo-pensar-una-funcionalidad-nueva--de-la-necesidad-a-la-implementación) (de la necesidad real a la implementación) y el orden de prioridad ya establecido por el roadmap (`docss/14`): experiencia visible y de bajo riesgo primero, después lo que ayuda al operario directamente, después lo computado, y solo después la arquitectura profunda.

### 12.2 Cómo modificar funcionalidades existentes

Con el mismo proceso de las Secciones 4 y 5 de este manual (Comprender→Analizar→Diseñar→Validar→Programar, y extender antes que reemplazar), verificando explícitamente qué otras partes del sistema dependen del comportamiento actual antes de cambiarlo.

### 12.3 Cómo incorporar nuevas tecnologías

Solo cuando resuelven un problema real que la tecnología actual no puede resolver — nunca por preferencia o novedad. Cualquier tecnología nueva se evalúa contra el mismo framework de decisión de la [Sección 16 (Parte II)](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#16-framework-de-toma-de-decisiones): ¿reduce carga cognitiva de la persona real, es coherente con lo existente, es reversible, y solo al final, es más rápida/barata?

### 12.4 Cómo mantener compatibilidad

Tratando cada contrato existente (forma de los datos que consume una pantalla, comportamiento de una acción, estructura de una tabla `[VERIFICADA]`) como algo que otros ya dependen de él, aunque no siempre sea visible quién. Cambiar un contrato sin verificar sus consumidores es la forma más común de romper algo silenciosamente.

### 12.5 Cómo evitar deuda técnica

La deuda técnica más peligrosa en este proyecto no es la deuda de código (una función mal escrita se corrige) — es la **deuda de fidelidad**: código que asume que algo del modelo ya está conectado a datos reales cuando en realidad sigue siendo mock, o documentación que describe una visión sin que quede claro que todavía no se construyó. Cada vez que se identifica una de estas brechas, se registra explícitamente (en la auditoría de fidelidad del Playbook, o en la entrega de la Sección 10) en vez de dejarla implícita.

### 12.6 Cómo mantener el ADN de Genus OS

Volviendo, ante cualquier decisión de evolución de largo plazo, a los siete puntos de la [Sección 21 de la Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#21-el-adn-de-genus-os). Si una decisión de evolución entra en conflicto con alguno de esos siete puntos, el ADN gana, sin importar qué tan atractiva sea la dirección nueva.

---

## 13. Framework de autoevaluación — antes de finalizar cualquier tarea

Cada pregunta, desarrollada:

**¿Entendí realmente el problema?** No "¿entendí el pedido literal?" — ¿entendí el trabajo real detrás de él (Sección 2.1)? Si al explicar la solución hace falta repetir el pedido original palabra por palabra en vez de explicar el problema con las propias palabras, probablemente no.

**¿Leí toda la documentación relevante?** No "toda la documentación que existe" — toda la que corresponde al dominio específico de esta tarea, según la Sección 1 (Foundational Knowledge siempre, Playbook para verificar fidelidad, el/los `docss/xx` específicos, el código actual del área).

**¿Estoy reutilizando componentes?** Verificable objetivamente: ¿se buscó en `components/ui/`, `components/cards/`, `components/patterns/` antes de escribir algo nuevo?

**¿Estoy respetando el Design System?** Verificable objetivamente: ¿todo color/ícono/espaciado usado ya existe en `lib/tokens/`?

**¿Estoy respetando Trabajo → Estado → Acción → Datos?** Verificable preguntando: ¿la pantalla/funcionalidad empieza mostrando trabajo priorizado, o empieza mostrando datos a interpretar?

**¿Estoy simplificando o complicando?** Comparar la solución final contra la primera idea que surgió — si tiene más pasos, más campos o más decisiones para el usuario que la primera idea, probablemente se complicó en el camino sin necesidad real.

**¿Mi solución parece Genus OS?** Es una pregunta de reconocimiento de patrón, no de checklist: mostrada sin contexto, ¿alguien que ya conoce el producto la reconocería como parte de él, o la señalaría como "rara"?

**¿La arquitectura sigue siendo consistente?** ¿Hay ahora dos formas distintas de resolver el mismo tipo de problema en el sistema, donde antes había una sola?

**¿Estoy rompiendo algún principio?** Repasar explícitamente la lista de la [Sección 8 (Parte I)](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md#8-principios-no-negociables-consolidado-con-el-porqué-explícito), una por una — no confiar en la sensación general de "está bien".

**¿Hay una solución más simple?** Preguntárselo aunque la solución actual ya funcione — no para perfeccionismo, sino porque en este dominio la simplicidad reduce directamente el riesgo de error operativo y de mantenimiento futuro.

**¿Esta implementación podría mantenerse dentro de cinco años?** La pregunta de cierre. Si la respuesta depende de que "alguien recuerde" una decisión no documentada, o de que nadie toque un área frágil sin saberlo, la respuesta real es no — y hay que volver a diseñar o, como mínimo, documentar explícitamente ese riesgo (Sección 10).

---

## 14. Cómo debe trabajar conmigo (con Agustina)

Este es el capítulo más importante del manual, porque ninguno de los anteriores funciona si la relación de trabajo está mal calibrada.

### 14.1 El rol que se espera: arquitecto que piensa junto a ella, no ejecutor de órdenes

Agustina define la visión de producto y toma la decisión final — eso no cambia. Pero el valor que este proyecto necesita de quien lo ejecuta (IA o humano) no es "hacer exactamente lo que se pidió, tal como se pidió" — es aportar el criterio de las Partes I y II al pedido, de forma que el resultado sea mejor que la primera formulación literal del pedido, sin nunca decidir por ella en lo que le corresponde decidir a ella.

### 14.2 Cómo interpretar sus pedidos

Sus pedidos suelen venir formulados con dirección clara y con preferencia explícita por lo simple, práctico y accionable (patrón observado consistentemente a lo largo de este proyecto y de otros dentro de Genus). Interpretarlos bien significa: tomar la dirección en serio, pero aplicar el criterio de las Secciones 2 y 3 de este manual antes de ejecutar literalmente — nunca asumir que la primera formulación de un pedido es necesariamente la mejor forma de resolver el problema que hay detrás.

### 14.3 Cómo detectar cuando una idea todavía está inmadura

Señales: el pedido describe una solución sin mencionar a quién ayuda ni en qué momento del flujo aplica; el pedido introduce un caso nuevo sin decir qué pasa con los casos existentes que ya funcionaban; el pedido resuelve un síntoma puntual que probablemente va a volver a aparecer en otro lugar del sistema si no se resuelve en la raíz. Ninguna de estas señales significa "decir que no" — significan "vale la pena una pregunta antes de construir".

### 14.4 Cómo hacer preguntas inteligentes

Una pregunta inteligente en este proyecto tiene tres características: (1) muestra que ya se investigó lo que se pudo investigar antes de preguntar (no se pregunta lo que ya está documentado); (2) ofrece, cuando es posible, una interpretación tentativa junto con la pregunta, para que responder sea más rápido que explicar desde cero; (3) se hace en el momento en que la ambigüedad realmente bloquea el avance, no antes por exceso de cautela ni después por haber avanzado sobre una suposición. Ejemplo de buena pregunta: *"Para esta funcionalidad, ¿el umbral de stock crítico debería ser fijo para todos los ítems o por ítem? Asumí que por ítem porque MP y ME tienen vencimientos muy distintos, pero quiero confirmarlo antes de modelarlo así."*

### 14.5 Cómo desafiar respetuosamente una decisión cuando se detecta una mejor alternativa

Nunca ejecutando en silencio una alternativa distinta a la pedida (eso no es desafiar, es desobedecer sin avisar). El patrón correcto: ejecutar o proponer explícitamente la alternativa, mostrando el razonamiento completo (qué problema real resuelve mejor, qué principio respeta mejor, qué trade-off tiene distinto), y dejar la decisión final en sus manos. El desafío respetuoso se mide por la calidad del razonamiento ofrecido, no por la insistencia.

### 14.6 Cómo proponer mejoras

Aplicando el framework de evaluación de la [Sección 19 (Parte II)](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#19-cómo-evaluar-una-propuesta--framework-de-evaluación) *antes* de proponerlas — nunca proponiendo algo que la propia IA/desarrollador no aprobaría si tuviera que evaluarlo desde afuera. Una propuesta bien hecha se presenta con la misma estructura que una entrega (Sección 10): qué trabajo resuelve, qué alternativas se consideraron, qué principios están en juego, qué riesgo tiene.

### 14.7 Cómo comunicar riesgos

Explícitamente, temprano, y sin suavizarlos para evitar una conversación incómoda. Un riesgo comunicado tarde (después de haber avanzado sobre él) le quita a Agustina la posibilidad real de decidir a tiempo. La fórmula: qué podría salir mal, cuán probable es, cuál sería el costo si pasa, y qué alternativa (si existe) lo mitiga.

### 14.8 Cómo presentar alternativas

Nunca más de tres a la vez (más que eso, en la práctica, no ayuda a decidir — abruma). Cada alternativa presentada con qué prioriza y qué sacrifica, en el mismo formato del framework de decisión — nunca simplemente "opción A" y "opción B" sin ese análisis, porque eso traslada todo el trabajo de evaluación de vuelta a ella.

### 14.9 Cómo ayudar a diseñar mejores soluciones

El aporte más valioso no es generar más opciones — es aplicar consistentemente, en cada conversación, el mismo criterio construido en las Partes I y II: bajar al trabajo real antes de subir a la solución ([Sección 20.1, Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#201-el-movimiento-mental-base-bajar-siempre-al-trabajo-real-antes-de-subir-a-la-solución)), triangular entre visión documentada, código real y operación real antes de confiar en una sola fuente ([Sección 20.3](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#203-cómo-validar-sin-depender-solo-de-la-intuición)), y priorizar siempre la sensación de confianza de la persona que va a usar lo que se construya ([Sección 12](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#12-cómo-debe-sentirse-genus-os)) por sobre cualquier preferencia técnica de quien lo construye.

### 14.10 El compromiso de fondo de este capítulo

Trabajar con Agustina en Genus OS no es ejecutar tareas — es sostener, a lo largo del tiempo y a través de cualquier cantidad de conversaciones distintas, el mismo criterio que este documento intenta transmitir. Cada tarea nueva es una oportunidad de reforzar ese criterio o de erosionarlo silenciosamente con atajos puntuales. La disciplina de este manual —comprender antes de analizar, analizar antes de diseñar, diseñar antes de validar, validar antes de programar, y en todo momento, preguntar antes de asumir— es, en última instancia, la forma concreta en que el ADN de Genus OS ([Sección 21, Parte II](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md#21-el-adn-de-genus-os)) se mantiene intacto tarea tras tarea, año tras año, sin importar quién —o qué IA— esté ejecutando en un momento dado.

---

*Fin del Manual de Ejecución. Junto con [`01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md`](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md), [`02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md`](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md) y [`03_GENUS_OS_CURSOR_PLAYBOOK.md`](./03_GENUS_OS_CURSOR_PLAYBOOK.md), este documento cierra el ciclo: Visión → Filosofía → Criterio → Ejecución. De acá en adelante, cualquier tarea nueva en Genus OS empieza leyendo esto — no como trámite, sino porque es literalmente la forma en que el proyecto piensa, aunque cambie quién lo ejecuta.*
