# GENUS_OS_FOUNDATIONAL_KNOWLEDGE — Parte I
### El conocimiento fundacional de Genus OS

> Este documento no es documentación técnica. Es la transmisión de un modelo mental. Si en cinco años alguien —humano o IA— lee esto sin haber hablado nunca con Agustina, sin haber visto `docss/`, sin haber abierto el código, debería poder razonar sobre Genus OS de la misma manera en que se razonó durante la construcción de este documento: entendiendo no solo las reglas, sino por qué cada regla existe, qué pasa si se rompe, y cómo se piensa una decisión nueva que nadie escribió todavía.
>
> Todo lo que sigue es síntesis, no copia. Donde haga falta el detalle exacto de un campo o una tabla, ese detalle vive en `docss/03`. Este documento no compite con eso: le da sentido.

---

## Índice

1. [Qué es Genus OS](#1-qué-es-genus-os)
2. [La filosofía del producto: Trabajo → Estado → Acción → Datos](#2-la-filosofía-del-producto-trabajo--estado--acción--datos)
3. [Cómo pensar Genus OS — el proceso mental, no solo las reglas](#3-cómo-pensar-genus-os--el-proceso-mental-no-solo-las-reglas)
4. [Cómo entender Laboratorio Genus — la empresa real, no la teoría](#4-cómo-entender-laboratorio-genus--la-empresa-real-no-la-teoría)
5. [Cómo debe pensar cualquier desarrollador](#5-cómo-debe-pensar-cualquier-desarrollador)
6. [Cómo debe pensar una IA que continúe este proyecto](#6-cómo-debe-pensar-una-ia-que-continúe-este-proyecto)
7. [Cómo debe evolucionar Genus OS](#7-cómo-debe-evolucionar-genus-os)
8. [Principios no negociables (consolidado, con el porqué explícito)](#8-principios-no-negociables-consolidado-con-el-porqué-explícito)
9. [Checklist de toma de decisiones — antes de implementar cualquier cambio](#9-checklist-de-toma-de-decisiones--antes-de-implementar-cualquier-cambio)
10. [Cómo reconocer una solución correcta — ejemplos](#10-cómo-reconocer-una-solución-correcta--ejemplos)
11. [Cómo trabajar con Cursor (o cualquier asistente de código) a lo largo del tiempo](#11-cómo-trabajar-con-cursor-o-cualquier-asistente-de-código-a-lo-largo-del-tiempo)

> Continúa en [`02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md`](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md) (Secciones 12–21: criterio, sensaciones, framework de decisión, antipatrones, ADN del producto).

---

# 1. Qué es Genus OS

## 1.1 El problema real, no el problema de superficie

El problema de superficie que cualquiera identificaría mirando Laboratorio Genus es: "usan muchas planillas dispersas, sería mejor tener un sistema". Ese diagnóstico es correcto pero superficial, y si se lo toma literalmente lleva a construir lo peor que se le puede construir a un laboratorio GMP: un ERP genérico con tablas, formularios y menús — es decir, exactamente el tipo de sistema que la gente de planta ya evita porque los obliga a pensar en la estructura del dato en vez de pensar en su trabajo.

El problema real es más profundo: **hoy, en Laboratorio Genus, el conocimiento de qué hacer vive en las personas, no en el sistema.** Cristian sabe que tiene que cerrar la OE-0042 porque conoce el proceso, no porque algo se lo dijo. Santiago sabe que hay tres lotes esperando análisis porque los recorrió, no porque una pantalla se los mostró priorizados. Esto funciona mientras las personas estén, mientras nadie se enferme, mientras la carga de trabajo no crezca, mientras no haya una inspección ANMAT que exija reconstruir en segundos la cadena completa de un lote. Es un sistema que depende de la memoria y la disciplina humana para sostener el cumplimiento regulatorio. Eso es frágil por diseño, no por mala voluntad de nadie.

Genus OS existe para mover ese conocimiento — "qué hacer, cuándo, quién, con qué evidencia" — de la cabeza de las personas al sistema, sin quitarles el criterio profesional que sí les corresponde (Calidad decide si un lote cumple; Dirección Técnica decide si se firma; eso nunca lo decide el software). El sistema no reemplaza el juicio humano regulado; reemplaza la necesidad de que una persona recuerde, busque y decida *dónde mirar*.

## 1.2 Por qué existe (la motivación GMP, no solo la operativa)

Hay dos motivaciones entrelazadas y hay que distinguirlas porque priorizan distinto:

- **Motivación de cumplimiento (no negociable, viene primero):** un laboratorio GMP bajo ANMAT tiene que poder demostrar, ante una inspección, la trazabilidad completa de cualquier lote — de qué materia prima salió, quién la aprobó, quién firmó la liberación, a qué pedido se despachó. Hoy eso existe, pero disperso en planillas y documentos Word por producto. Reconstruirlo a mano es lento y frágil. Genus OS lo hace estructuralmente imposible de perder: cada movimiento de stock queda escrito para siempre (append-only), cada liberación queda firmada para siempre, y la cadena PT→OA→Granel→OE→MP siempre es reconstruible.
- **Motivación operativa (importa, pero es secundaria a la anterior):** menos tiempo decidiendo qué hacer, menos error humano, menos retrabajo. Esto es lo que la gente va a *sentir* primero, pero no es lo que justifica cada decisión de arquitectura. Cuando una decisión operativa (por ejemplo, "sería más rápido si el operario pudiera editar un movimiento mal cargado") entra en conflicto con una decisión de cumplimiento (append-only), **gana el cumplimiento, siempre**. La velocidad se resuelve con mejor UX de carga, nunca permitiendo editar el libro mayor.

## 1.3 Qué lo hace diferente de un ERP tradicional

Un ERP tradicional (SAP, Odoo genérico, o el AppSheet de hoy usado "a la antigua") organiza el software por **tipo de dato**: hay un módulo de Inventario, uno de Producción, uno de Ventas. El usuario entra, decide en qué módulo está lo que necesita, navega, filtra, encuentra, actúa. El sistema es pasivo: espera que alguien venga a buscarlo.

Genus OS invierte esa relación. Organiza el software por **estado del trabajo**: cada entidad (una OE, un lote, una liberación, un pedido) tiene un estado, y ese estado determina automáticamente quién tiene que hacer algo a continuación. El usuario abre el sistema y el sistema ya sabe qué le toca. El sistema es activo: reparte.

Esto no es una capa de UX cosmética sobre un ERP normal. Es una decisión de arquitectura: significa que el estado de cada entidad tiene que ser una fuente de verdad computable (no un campo libre que alguien tipea), porque de eso depende literalmente calcular quién recibe cada tarea. Un ERP tradicional puede tener campos de estado inconsistentes o mal mantenidos y sigue funcionando, porque al final es el humano el que navega y decide. Genus OS no puede permitirse eso: si el estado está mal, el sistema le muestra a la persona equivocada la tarea equivocada, o peor, no le muestra nada a nadie y un lote queda invisible en el limbo. Por eso la regla "los estados se derivan, nunca se tipean" no es una preferencia de estilo: es una precondición para que el concepto central del producto (la Bandeja Inteligente) pueda existir.

## 1.4 Qué objetivos tiene, en orden de prioridad real

1. Trazabilidad GMP total, exigible en una inspección ANMAT sin trabajo manual de reconstrucción.
2. Cero error operativo evitable — el sistema previene, no corrige después.
3. Segregación de funciones garantizada por el sistema, no por la buena voluntad de las personas.
4. Una sola fuente de verdad — eliminar las planillas paralelas.
5. Reducir la carga cognitiva de cada persona — que el sistema le diga qué hacer.
6. Visibilidad en tiempo casi real para quien supervisa o dirige.

El orden importa: cuando dos objetivos compiten (por ejemplo, "más rápido de cargar" contra "más trazable"), el orden de esta lista decide.

## 1.5 Qué nunca pretende ser

- **No pretende ser un sistema configurable genérico** para cualquier fábrica. Está construido a la medida de cómo trabaja Laboratorio Genus específicamente (elaboración → acondicionamiento, dos barreras de liberación, esta matriz de roles). No hay que generalizarlo prematuramente para "servir a cualquier laboratorio" — esa generalización, si algún día tiene sentido comercial, es una decisión de negocio futura y separada, no algo a resolver ahora "por las dudas".
- **No pretende reemplazar el backend actual.** No es un proyecto de migración de Google Sheets a una base de datos propia. Es una nueva interfaz sobre la misma fuente de verdad.
- **No pretende que la IA (Creamy) tome decisiones regulatorias.** Por diseño, cualquier asistente conversacional futuro deriva, no decide, en todo lo que toque liberación, desvío o cambio de fórmula.
- **No pretende ser "lindo" antes que correcto.** El Design System existe para dar claridad y confianza (estética "industrial limpia"), no para impresionar. Si una animación o un color no comunica estado o acción, no tiene lugar en Genus OS.

---

# 2. La filosofía del producto: Trabajo → Estado → Acción → Datos

## 2.1 Por qué este orden y no otro

Casi cualquier equipo de software, al construir un sistema nuevo, empieza por el dato: "¿qué tablas necesito?". Es el camino natural porque es el que enseña la ingeniería de software clásica. Pero ese camino, aplicado acá, produce sistemas que se parecen a AppSheet-a-la-antigua: pantallas que son la tabla con un formulario encima. Funcionalmente correcto, experiencialmente hostil, porque obliga a la persona a traducir mentalmente "tengo que ver qué registros de OE_CONSUMO me faltan cargar hoy" en vez de simplemente "cargá el lote que usaste".

Genus OS empieza al revés, y cada paso de la cadena depende del anterior:

1. **Trabajo.** ¿Qué necesita el laboratorio que pase? (Un granel tiene que producirse, un lote tiene que analizarse, un pedido tiene que despacharse.) Esto es lo único con lo que la persona en planta se identifica de verdad. Nadie en planta piensa "tengo que interactuar con la tabla OE_CONSUMO"; piensa "tengo que hacer la crema".
2. **Estado.** Ese trabajo, en un momento dado, está en algún punto de su ciclo de vida (Planificada, En curso, Cerrada; Cuarentena, Liberado). El estado es lo que le dice al sistema en qué punto de la cadena está algo y, por lo tanto, quién es responsable ahora.
3. **Acción.** Dado el estado, hay exactamente una (o pocas) acción válida siguiente. No hay ambigüedad: si un granel está en Cuarentena, la acción que corresponde es "analizar/disponer", no "despachar" (eso ni siquiera debería estar disponible en la interfaz).
4. **Datos.** Recién acá aparece el dato — como lo que la acción necesita leer o escribir, nunca como lo primero que el usuario ve.

Si se invierte este orden (empezar por datos), el resultado es una tabla editable con validaciones — technically correcto, experiencialmente una base de datos. Si se respeta este orden, el resultado es una tarjeta con una acción — technically lo mismo por debajo, experiencialmente un asistente.

## 2.2 Cómo impacta cada decisión de producto

Cada vez que se diseña una pantalla nueva, la primera pregunta nunca es "¿qué campos necesito mostrar?" sino "¿qué trabajo resuelve esta pantalla, en qué estados puede estar ese trabajo, y cuál es la única acción que tiene sentido en cada estado?". Recién con esa respuesta se decide qué datos hacen falta para sostenerla — y frecuentemente son muchos menos de los que "mostrar toda la tabla" hubiera sugerido. Este es el motivo real detrás de la regla de Design System "claridad sobre densidad, mostrar lo necesario no todo lo posible": no es una preferencia estética, es una consecuencia directa de pensar en trabajo antes que en dato.

## 2.3 Cómo impacta la UX

La Bandeja Inteligente (`docss/09`) es la materialización literal de esta cadena: es una vista que no muestra entidades, muestra *trabajo priorizado*. La gramática de card única (identidad · título · badge de estado · metadatos · urgencia · una acción primaria) es la cadena Trabajo→Estado→Acción comprimida en un componente visual: el título es el trabajo, el badge es el estado, el botón es la acción. Los datos (metadatos) están ahí de apoyo, en texto chico, nunca como protagonistas.

Esto también explica por qué las tablas están explícitamente proscriptas como superficie de trabajo (`docss/07` §3, §6): una tabla muestra datos primero. Es la estructura opuesta a la que el producto necesita para operarios en planta. Las tablas siguen existiendo — para auditoría y consulta, que es exactamente el contexto donde el dato sí debe ser protagonista.

## 2.4 Cómo impacta la arquitectura

Para que "el sistema le diga a la persona qué hacer" sea posible sin que alguien lo programe a mano entidad por entidad, el estado de cada cosa tiene que ser computable, no tipeado. De ahí nacen directamente los principios no negociables de append-only y derivación: si el estado de un lote fuera un campo libre que cualquiera puede escribir, el sistema no podría confiar en él para decidir a quién mostrarle qué tarea — se rompería la cadena completa. La arquitectura de datos de Genus OS (libro mayor + estados derivados) no es una elección de ingeniería aislada: es la precondición técnica que hace posible la filosofía de producto. Si algún día alguien propone "vamos a simplificar y que el estado sea un campo editable directo", hay que entender que esa propuesta no es un detalle técnico menor: es matar la posibilidad de que el sistema sea un asistente y volver a que sea una base de datos.

## 2.5 Cómo impacta el frontend

El frontend nunca debería tener una pantalla cuyo punto de entrada sea "elegí una tabla y filtrá". El punto de entrada siempre es un Workspace (una misión) con secciones de trabajo por significado (Ahora, En cola, Esperando aprobación, Esperando a otros, Problemas, Finalizados), y dentro de eso, cards accionables. Object pages (el detalle de una entidad) existen, pero se llega a ellas *desde* una tarea, no como punto de partida.

## 2.6 Cómo impacta el backend

El backend actual (Sheets + AppSheet) ya modela parcialmente esta filosofía con sus fórmulas de estado derivado y sus automatizaciones (bots). Lo que falta —la tabla `TAREAS`— es precisamente la pieza que convierte "estado derivado, disperso en varias tablas" en "una cola de trabajo unificada y priorizada". Por eso `docss/09` la llama "la gran apuesta": no es una funcionalidad más, es la pieza de arquitectura que hace que el resto de la filosofía deje de ser una aproximación (secciones por slice en cada Workspace) y se vuelva real (una bandeja única).

---

# 3. Cómo pensar Genus OS — el proceso mental, no solo las reglas

## 3.1 El test de una decisión

Frente a cualquier decisión de producto o de ingeniería, hay una pregunta madre, y todo lo demás es una elaboración de ella:

> **¿Esta decisión ayuda a que una persona en planta, con guantes puestos, bajo presión, sepa exactamente qué hacer sin tener que pensar ni buscar — y sin que eso ponga en riesgo la trazabilidad GMP?**

Si la respuesta es sí a ambas partes, la decisión probablemente está bien encaminada. Si compromete la segunda parte para mejorar la primera (por ejemplo, "dejemos que el operario edite un movimiento si se equivocó, así es más rápido"), la decisión está mal, sin importar cuánto mejore la velocidad percibida — porque la trazabilidad no es negociable y la velocidad sí tiene otras formas de resolverse (por ejemplo, un flujo de "corrección" que registra un movimiento nuevo de ajuste, visible y auditable, en vez de editar el original).

## 3.2 Cómo decidir entre dos soluciones que parecen igual de válidas

Cuando dos soluciones técnicas parecen razonables, el criterio de desempate, en orden:

1. **¿Cuál respeta más los principios no negociables ([Sección 8](#8-principios-no-negociables-consolidado-con-el-porqué-explícito)) sin necesitar excepciones?** Si una solución necesita "una excepción a la regla append-only, solo esta vez", ya perdió, sin importar cuán elegante sea en lo demás.
2. **¿Cuál requiere menos que la persona en planta decida o interprete?** Entre una solución que ofrece dos botones ("Marcar en tolerancia" / "Marcar fuera de tolerancia") y otra que ofrece un campo de texto libre para que el operario describa la situación, gana la primera — aunque la segunda sea "más flexible" en abstracto. La flexibilidad para el operario en planta casi siempre es carga cognitiva, no libertad.
3. **¿Cuál es más aditiva (menos rompe lo que ya funciona)?** Entre reescribir una fórmula existente y agregar una columna nueva al final, gana agregar. Siempre.
4. **¿Cuál es más consistente con el vocabulario ya establecido?** Si ya existe el patrón "Workspace → Secciones canónicas → Cards", una funcionalidad nueva que inventa su propia estructura de navegación está mal, aunque resuelva bien su problema puntual — porque rompe la promesa de "aprender un Workspace sirve para entenderlos todos".
5. Solo si las cuatro anteriores empatan, el criterio de desempate final es la velocidad de desarrollo o el costo.

## 3.3 Cómo detectar una mala solución (incluso si "funciona")

Las malas soluciones en este proyecto casi nunca fallan por bugs. Fallan porque parecen razonables y silenciosamente traicionan la filosofía. Señales de alerta, aprendidas de leer cómo está construido hoy el sistema:

- **Si la solución agrega un campo que "cachea" o "duplica" algo que ya se puede derivar** (por ejemplo, un campo `estado_manual` al lado del estado derivado, "por si acaso"), es una mala solución aunque resuelva un caso puntual rápido. Introduce dos fuentes de verdad, que es exactamente lo que el append-only existe para evitar.
- **Si la solución necesita que el operario lea una tabla o decida entre más de una acción visible**, es una mala solución de UX, aunque el dato subyacente esté perfecto.
- **Si la solución introduce un color o ícono nuevo "solo para este caso"**, es una mala solución de diseño — hay que resolver dentro del vocabulario existente de 5 tokens, o proponer formalmente extender el sistema (no inventar en una pantalla suelta).
- **Si la solución asume que el front-end puede confiar en sí mismo para autorizar** ("total, el botón ya está oculto para ese rol"), es una mala solución de seguridad — la ocultación en UI nunca es la autorización real.
- **Si la solución "por ahora" hardcodea un permiso o una regla de negocio en código** en vez de leerla de `PERMISOS`/`PARAMETROS`, es una mala solución de arquitectura, aunque sea más rápida de escribir hoy — porque reintroduce exactamente el problema que la tabla guiada por datos vino a resolver (cambiar un permiso debería ser cambiar una fila, no re-desplegar código).

## 3.4 Cómo detectar una buena solución

Una buena solución en Genus OS generalmente se puede describir en una frase sin usar la palabra "tabla", "campo" o "formulario", y usando en cambio palabras como "tarea", "avisa", "impide", "muestra". Ejemplo real tomado del propio sistema: la regla de consumo de MP no se describe como "el formulario de OE_CONSUMO valida que LOTE_ID pertenezca al MP correcto" (aunque técnicamente eso es lo que pasa) — se describe como "el sistema no te deja cargar un lote que no sea el correcto: si te equivocás, te lo dice antes de guardar y te explica por qué". La primera descripción es la implementación; la segunda es el producto. Cuando una propuesta nueva solo puede describirse en el lenguaje de la primera, probablemente está resolviendo el problema equivocado.

---

# 4. Cómo entender Laboratorio Genus — la empresa real, no la teoría

## 4.1 Quién hace qué, en la práctica

Es un laboratorio chico (~40 personas) donde los roles del sistema (`ROL-OP`, `ROL-SU`, etc.) mapean a personas concretas y conocidas, no a departamentos abstractos de una multinacional. Esto importa: las decisiones de UX tienen que asumir que Cristian, Nicolás y Santino (elaboración), Belén (depósito), Santiago (calidad), Agustina (supervisión), y el Farmacéutico Caio David Zunich (Dirección Técnica) son personas reales que van a usar esto todos los días, con nombres reales, no personas abstractas de un caso de estudio. El sistema tiene que hablarles a ellos, en su idioma cotidiano, no en jerga de sistemas.

## 4.2 La lógica productiva real (más allá del diagrama)

El laboratorio no fabrica "productos": fabrica **granel** primero y **producto terminado** después, y son dos procesos con maquinaria, personas y riesgos distintos. Elaboración mezcla materias primas según una fórmula para producir un granel a granel (líquido, crema, lo que sea, medido en kg/densidad). Acondicionamiento toma ese granel — pero solo si ya fue liberado por calidad — y lo envasa, etiqueta y empaca en el packaging específico de cada marca cliente, produciendo el SKU final. Una fórmula de granel puede terminar en múltiples SKUs de distintas marcas (mismo shampoo, distinto frasco y etiqueta para cada cliente) — por eso "una OE puede alimentar muchas OA", y por eso "una OA = un PT" (nunca ambigüedad de qué se está envasando en una orden dada).

## 4.3 Por qué existen las dos barreras de liberación y no una sola

Podría pensarse "¿por qué no liberar directamente el producto terminado y ahorrarse la liberación intermedia del granel?". La respuesta real: si un granel resulta no conforme y ya se envasó en cinco SKUs distintos de tres marcas distintas antes de descubrirlo, el desperdicio (de material de empaque, de tiempo, de riesgo regulatorio) es mucho mayor que si se detiene *antes* de acondicionar. La primera barrera protege la inversión de acondicionamiento; la segunda protege el producto final que llega al cliente. Son dos momentos de decisión distintos, con distinta evidencia disponible (antes de envasar solo hay evidencia del granel; después hay evidencia del producto completo, incluyendo el envasado en sí).

## 4.4 Por qué el lote de material de empaque importa tanto

El propio `docss/01` menciona explícitamente un "hueco crítico histórico": el lote del material de empaque (frascos, tapas, etiquetas) no se registraba en el acondicionamiento. Esto no es un detalle menor — en una inspección ANMAT, si aparece un problema con un lote de frascos defectuosos (por ejemplo, una tapa que no cierra bien y compromete la estabilidad del producto), sin ese registro es imposible saber qué productos terminados usaron esos frascos específicos, y la única salida sería un recall masivo de todo lo producido en un rango de fechas amplio en vez de un recall quirúrgico de los lotes exactos afectados. Por eso el modelo obliga a registrar cada material de empaque por lote dentro de la OA — no es burocracia, es lo que hace la diferencia entre un recall de 200 unidades y uno de 20.000.

## 4.5 Los documentos reales y su relación con el modelo ideal

Vale la pena internalizar esto con crudeza: hoy, en la práctica, una Orden de Acondicionamiento es un documento Word con una tabla de celdas fusionadas que alguien llena a mano (visto directamente en el archivo real de Crema Facial Laude). Una Orden de Elaboración es una hoja de Excel por producto. El log de lotes es una pestaña de Excel por mes. Esto no es un fracaso del proyecto — es exactamente el punto de partida que Genus OS existe para transformar. Cualquiera que trabaje en este proyecto debería mirar esos documentos reales de vez en cuando (no solo el modelo idealizado de `docss/03`) para no perder de vista que la distancia entre "lo que se documentó como visión" y "lo que hoy se llena a mano" es considerable, y que cerrar esa distancia — sin romper el cumplimiento mientras tanto — es el trabajo real.

## 4.6 Las restricciones GMP que no son "reglas de negocio", son la razón de ser del sistema

Es tentador, para alguien que viene de construir software genérico, tratar "append-only", "segregación de funciones" y "trazabilidad" como si fueran requerimientos de negocio entre otros. No lo son. Son la razón por la que el sistema existe. Un ERP sin estas restricciones sería más simple de construir y "funcionaría" en el sentido de que la gente podría cargar pedidos y ver stock. Pero no serviría para lo único que Genus OS tiene que garantizar antes que cualquier otra cosa: que ante una inspección ANMAT, el laboratorio pueda demostrar, sin ambigüedad, quién hizo qué, cuándo, con qué lote, y quién lo aprobó. Cada vez que una decisión de ingeniería facilita algo a costa de esto, está resolviendo el problema equivocado.

---

# 5. Cómo debe pensar cualquier desarrollador

## 5.1 Principios que nunca debe romper

Ya están enumerados con detalle técnico en la [Sección 8](#8-principios-no-negociables-consolidado-con-el-porqué-explícito) de este documento y en `docss/02`/`docss/20`. Acá lo importante es la actitud: un desarrollador nuevo en este proyecto debe asumir, por defecto, que **si algo en el backend parece innecesariamente rígido o anticuado, hay una razón GMP detrás, no negligencia**. La pregunta correcta nunca es "¿por qué esto es tan complicado, lo simplifico?" sino "¿qué pasaría en una inspección si esto no fuera así?". Casi siempre la respuesta a esa segunda pregunta explica la "complicación".

## 5.2 Errores que nunca debe cometer

- Editar o borrar una fila de `MOVIMIENTOS` o `LIBERACIONES`, incluso "para arreglar un dato de prueba". Ese hábito, aplicado sin pensar en producción, es un incidente de cumplimiento.
- Escribir un valor negativo a mano en `cantidad` en vez de dejar que `cantidad_signo` lo calcule.
- Crear un campo de estado manual "porque es más simple que calcularlo" — siempre rompe la garantía de que el estado es confiable para decidir a quién mostrarle una tarea.
- Confiar en que ocultar un botón en la UI es suficiente autorización.
- Asumir que porque algo está en `docss/03` marcado `[DISEÑADA]` o `[PROPUESTA]`, ya existe como tabla real en el Sheet de producción — hay que verificarlo (ver la auditoría de fidelidad documentada en `03_GENUS_OS_CURSOR_PLAYBOOK.md`).
- Tratar un módulo futuro (Creamy, Comunicación, Procedimientos, Capacitaciones) como si tuviera alcance ya decidido — no lo tiene; son propuestas de dirección, no especificaciones.

## 5.3 Cosas que parecen buenas pero rompen la filosofía

- **"Démosle al operario acceso de lectura a todas las tablas, por transparencia."** Suena bien, pero reintroduce la carga cognitiva que el sistema existe para eliminar: alguien que puede ver todo tiene que decidir qué mirar. La transparencia correcta en Genus OS es que el operario vea *su* trabajo, priorizado, no que vea todo el sistema.
- **"Agreguemos un campo de comentario libre en cada acción, para flexibilidad."** Sin cuidado, esto se convierte en el lugar donde termina viviendo información crítica de forma no estructurada (por ejemplo, una desviación de calidad anotada como comentario libre en vez de como una fila de `ANALISIS_CALIDAD`). El comentario libre tiene su lugar (el chatter/actividad de una object page), pero nunca debe ser el sustituto de un campo estructurado que el sistema necesita para derivar estado.
- **"Simplifiquemos el RBAC, totas las personas de producción tienen básicamente los mismos permisos."** Rompe la segregación de funciones GMP, que es exactamente lo que distingue a este sistema de una planilla compartida.
- **"Hagamos que Dirección Técnica pueda editar directamente el estado de un lote rechazado, para casos excepcionales."** Cualquier excepción a la regla "el estado se deriva de `LIBERACIONES`" reintroduce edición manual de estado — la excepción, sin importar cuán rara sea la necesidad real, tiene que resolverse como una fila nueva en `LIBERACIONES` (una reconsideración, documentada, firmada), nunca como una edición directa.

## 5.4 Decisiones que siempre deben justificarse por escrito

- Cualquier cambio no aditivo a una tabla marcada `[VERIFICADA]`.
- Cualquier excepción, por chica que sea, a append-only.
- Cualquier ampliación del alcance de un módulo futuro marcado explícitamente como no diseñado en detalle.
- Cualquier decisión de UX que agregue una segunda acción primaria visible en una misma pantalla.
- Cualquier decisión que introduzca un color, ícono o componente visual fuera del Design System vigente.

---

# 6. Cómo debe pensar una IA que continúe este proyecto

## 6.1 Qué hacer primero, en orden

1. Leer este documento completo (Partes I y II).
2. Leer `docss/README.md` y de ahí el índice completo de `docss/00`–`docss/20`, en el orden que el propio README recomienda según el objetivo de la tarea.
3. Leer `03_GENUS_OS_CURSOR_PLAYBOOK.md` — ahí está la auditoría de qué de `docss/` ya es realidad en el código y qué sigue siendo blueprint.
4. Antes de tocar código, mirar el estado real del repositorio: qué adapter está activo (`mock`/`drive`/futuro `api`), qué tablas del modelo ya están conectadas de verdad y cuáles no. No asumir fidelidad 1:1 entre lo documentado como visión y lo que existe en producción — verificarlo.
5. Recién ahí, empezar la tarea concreta que se le haya pedido.

## 6.2 Cómo validar un cambio antes de proponerlo

Aplicar el test de la [Sección 3.1](#31-el-test-de-una-decisión) (¿ayuda a que la persona en planta sepa qué hacer sin pensar, sin comprometer trazabilidad?) y el checklist de la [Sección 9](#9-checklist-de-toma-de-decisiones--antes-de-implementar-cualquier-cambio). Si el cambio toca el modelo de datos, verificar contra los principios no negociables ([Sección 8](#8-principios-no-negociables-consolidado-con-el-porqué-explícito)) uno por uno, explícitamente, no de memoria.

## 6.3 Cómo trabajar sin romper la arquitectura

Todo cambio, por defecto, es aditivo. Si una tarea *parece* requerir romper algo existente, la reacción correcta no es "encontrar la forma de hacerlo funcionar igual" sino **detenerse y decir explícitamente qué principio entra en conflicto y por qué**, dejando que sea una persona (Agustina, o eventualmente Dirección Técnica si el conflicto es regulatorio) quien decida si ese es un caso legítimo de excepción — que además, si se aprueba, debería documentarse como tal, no aplicarse en silencio.

## 6.4 Cómo hacer propuestas

Una propuesta bien hecha en este proyecto: (a) identifica qué trabajo de una persona real mejora, (b) explica en qué estado de qué entidad aplica, (c) dice explícitamente si es aditiva o no, (d) dice qué principios de la [Sección 8](#8-principios-no-negociables-consolidado-con-el-porqué-explícito) toca y cómo los respeta, (e) si introduce UI nueva, dice qué componente del Design System reutiliza o si necesita extenderlo. Una propuesta mal hecha describe una funcionalidad en abstracto ("agreguemos notificaciones") sin anclarla a un estado, un rol y una acción concretos.

## 6.5 Cómo trabajar junto a Agustina

Agustina define la visión de producto y valida las decisiones — eso no cambia aunque el trabajo día a día lo lleve adelante una IA. Su estilo de trabajo, observado a lo largo de este proyecto y de otros dentro de Genus, es: prefiere resultados prácticos, simples y accionables antes que teóricos o sobre-elaborados; corrige activamente hacia la reducción y la claridad cuando un entregable resulta demasiado complejo; comunica en español informal y directo. Cualquier IA que continúe el trabajo debería adoptar ese mismo criterio de simplicidad como default, y reservar la complejidad solo para donde el negocio (GMP, trazabilidad) realmente la exige — nunca por elegancia técnica gratuita.

Cuando haya ambigüedad real sobre alcance o sobre una decisión regulatoria (por ejemplo, el alcance de un módulo futuro), la respuesta correcta es preguntar explícitamente, no inventar una decisión razonable y avanzar. `docss/20` §8 ya lo dice: "ante la duda, preguntá" — vale tanto para Cursor en 2026 como para cualquier IA que lea esto en el futuro.

---

# 7. Cómo debe evolucionar Genus OS

## 7.1 La visión de largo plazo, en una frase

Que Genus OS deje de aproximar el concepto de "asistente" con secciones por estado dentro de cada Workspace, y se convierta en un asistente real: una Bandeja Inteligente única, alimentada por una tabla `TAREAS` que unifica todas las entidades, con automatizaciones que mueven la posta sin intervención manual, y con Creamy como capa conversacional encima de todo eso — respetando siempre que la decisión regulatoria la sigue tomando una persona.

## 7.2 Qué todavía no existe (y hay que dejar de asumir que existe)

- La tabla `TAREAS` y sus automatizaciones — es plomería invisible pero es la pieza que más cambia la naturaleza del producto cuando exista.
- La capa de API propia (`docss/17`) — hoy el frontend habla directo con adapters a Drive/Sheets; no hay una capa de servicio intermedia con RBAC del lado servidor real.
- `MOVIMIENTOS`/`SALDOS`/`ANALISIS_CALIDAD`/`LIBERACIONES` conectados de verdad al frontend — hoy son solo tipos y mocks, o partes explícitamente marcadas "no incluidas" en el adapter real.
- Los cuatro módulos futuros (Creamy, Comunicación, Procedimientos, Capacitaciones) — existen solo como propuesta de dirección.

## 7.3 Qué dirección debe seguir el producto

La secuencia correcta, siguiendo la propia lógica del roadmap (`docss/14`): primero la cara nueva y la experiencia (bajo riesgo, alto impacto perceptible, no toca modelo ni seguridad), después el operario guiado con formularios reales conectados a datos reales, después los KPIs computados y las primeras notificaciones, y solo después de ganado ese terreno, la inteligencia profunda (`TAREAS`, automatizaciones de la posta, notificaciones push). Es tentador para un desarrollador nuevo (o una IA entusiasta) querer construir `TAREAS` primero porque es la pieza arquitectónicamente más interesante — hay que resistir esa tentación: el propio roadmap la llama "la gran apuesta, pero después de los quick wins" por una razón de gestión de riesgo, no de preferencia técnica.

## 7.4 Qué decisiones futuras ya están prácticamente tomadas

- Workspaces por misión, con el rol como lente — no se va a volver a un modelo de navegación por módulo puro.
- Backend actual (Sheets + AppSheet) se mantiene como sistema de registro; cualquier evolución de almacenamiento ocurre "detrás" de una API sin romper contratos, si es que eso llega a pasar.
- El Design System de 5 tokens semánticos y gramática de card única es la base visual definitiva; no se va a rediseñar desde cero.
- Material de empaque siempre se consume por lote — esa decisión ya corrigió un hueco GMP real y no se revierte.

## 7.5 Qué partes todavía deben descubrirse

- El esquema exacto de `TAREAS` y sus reglas de priorización numérica.
- El alcance regulatorio real de Creamy — qué puede y no puede responder sin supervisión.
- El modelo de datos de Procedimientos/POEs y cómo se integra con la evidencia de Calidad.
- Cómo se resuelve, en la práctica del día a día (no solo en el modelo teórico), la normalización de `PEDIDOS`, `OE`, `OA` desde el formato semi-libre que hoy tienen en los documentos reales del laboratorio hacia el modelo estructurado — este es, probablemente, el trabajo de ingeniería de datos más grande y menos glamoroso que queda pendiente, y es fácil subestimarlo por estar "resuelto en el modelo" cuando en la operación real no lo está todavía.

---

# 8. Principios no negociables (consolidado, con el porqué explícito)

## 8.1 Arquitectónicos

| Principio | Por qué existe |
|---|---|
| `MOVIMIENTOS` append-only | Es la única forma de que el inventario sea auditable ante ANMAT sin ambigüedad de "qué pasó realmente". |
| `SALDOS` derivado, nunca editado | Si se pudiera editar directamente, dejaría de ser una consecuencia confiable de `MOVIMIENTOS`, y el sistema no podría confiar en él para bloquear un consumo inválido. |
| `LIBERACIONES` append-only, única vía de cambio de `LOTES.estado` | Es el registro legal de la decisión de calidad/DT. Editarlo directamente sería falsificar un acto regulatorio. |
| Estados derivados, nunca tipeados | Es la precondición técnica de que el sistema pueda calcular, sin intervención humana, a quién mostrarle qué tarea (ver [Sección 2.4](#24-cómo-impacta-la-arquitectura)). |
| BOM versionado, congelado en OE/OA | Sin esto, cambiar una fórmula hoy alteraría silenciosamente qué se supone que se produjo en una orden de hace seis meses — inaceptable para una investigación de desvío. |
| Dos barreras de liberación humanas | Detienen el flujo en dos momentos con distinta evidencia disponible, minimizando el costo de un desvío no detectado a tiempo (ver [Sección 4.3](#43-por-qué-existen-las-dos-barreras-de-liberación-y-no-una-sola)). |
| Trazabilidad completa por lote | Es literalmente el objetivo #1 del producto — todo lo demás está subordinado a esto. |
| Segregación de funciones | Sin esto, "quien produce se autoaprueba", que es precisamente lo que una inspección GMP audita como riesgo de fraude o negligencia no detectada. |

## 8.2 Funcionales

- El cumplimiento de un renglón de pedido siempre se deriva de los despachos reales, nunca se marca a mano.
- Una OA siempre corresponde a un único PT — evita ambigüedad de qué se está envasando y con qué evidencia de calidad.
- El material de empaque se consume por lote — corrige el hueco histórico descrito en la [Sección 4.4](#44-por-qué-el-lote-de-material-de-empaque-importa-tanto).
- El despacho es directo contra el renglón de pedido, sin una entidad "Orden de Despacho" intermedia — menos entidades, menos superficies donde el dato pueda divergir de la realidad.

## 8.3 De UX

- Una acción primaria por pantalla — reduce a cero la ambigüedad de "qué tengo que hacer ahora" en cada contexto, que es la promesa central del producto.
- El estado se reconoce (color + ícono), no se recuerda — reduce carga cognitiva, especialmente crítico para alguien trabajando con guantes, bajo presión de tiempo, en planta.
- Tablas solo para consulta/auditoría — mantiene la separación entre "trabajar" (guiado, de a un paso) y "auditar" (denso, de referencia), que son necesidades opuestas y no deben mezclarse en una misma pantalla.
- Empty states positivos — refuerzan la sensación de "sistema que te acompaña" en vez de "base de datos vacía", coherente con la filosofía de asistente.

## 8.4 Visuales

- Un significado = un color, siempre — la garantía de que el color comunica sin necesidad de leer texto, que es justamente lo que permite reconocer en menos de tres segundos qué es urgente en una pantalla.
- Verde reservado a "aprobado por calidad", nunca a "terminado" genérico — evita que alguien confunda "cerrado administrativamente" (gris, neutro) con "aprobado regulatoriamente" (verde, con peso legal).
- Azul solo para acción/marca, nunca estado — si el azul significara a veces estado y a veces acción, dejaría de ser una señal confiable de "esto es lo que tengo que tocar".

## 8.5 Regulatorios

- Nada de lo que Creamy (o cualquier asistente conversacional futuro) diga puede sustituir la firma de Dirección Técnica ni la decisión de Calidad.
- Toda escritura crítica lleva usuario, timestamp y referencia — sin excepción, sin "escritura anónima" en ningún flujo.
- Documentación controlada (POEs) siempre versionada, con una sola versión vigente a la vez — un requisito GMP básico que cualquier módulo de Procedimientos futuro debe respetar desde el diseño, no agregar después.

## 8.6 De desarrollo

- Todo cambio al modelo es aditivo por defecto.
- Toda validación crítica se revalida del lado servidor, nunca se confía solo en el cliente.
- Ningún componente visual se inventa suelto en una pantalla; se agrega al Design System primero.
- Ante la duda sobre alcance regulatorio o de producto, se pregunta antes de decidir.

---

# 9. Checklist de toma de decisiones — antes de implementar cualquier cambio

1. **¿Qué trabajo real de qué persona mejora esto?** Si la respuesta es abstracta ("mejora la arquitectura" sin más), falta anclar la decisión a un caso de uso concreto.
2. **¿En qué estado de qué entidad aplica, y cuál es la única acción esperada ahí?** Si la respuesta involucra "el usuario elige entre varias opciones", revisar si de verdad son necesarias todas o si el estado ya debería determinar una sola.
3. **¿Es aditivo?** Si no lo es, ¿está explícitamente justificado y quién lo aprobó?
4. **¿Toca alguno de los principios no negociables de la [Sección 8](#8-principios-no-negociables-consolidado-con-el-porqué-explícito)?** Enumerarlos explícitamente, uno por uno, no de memoria.
5. **¿La autorización real de esta acción se valida del lado servidor, o solo se oculta en la UI?**
6. **¿Reutiliza el Design System existente, o introduce algo nuevo?** Si introduce algo nuevo, ¿se agregó primero al sistema (`docss/07`) antes de usarse en esta pantalla puntual?
7. **¿Este cambio asume que una tabla o dato existe en producción?** Verificar contra la auditoría de fidelidad real (no contra la marca `[DISEÑADA]`/`[PROPUESTA]` de `docss/03` sin más).
8. **¿Toca un módulo marcado como "futuro propuesto" (Creamy, Comunicación, Procedimientos, Capacitaciones)?** Si sí, ¿el alcance está confirmado con Dirección Técnica/Calidad o se está asumiendo?
9. **¿Qué pasaría si esto se mostrara en una inspección ANMAT?** Si la respuesta genera dudas, no avanzar sin resolverlas primero.
10. **¿Puedo describir esta solución en el lenguaje de "tarea/avisa/impide/muestra" sin caer en "tabla/campo/formulario"?** Si no puedo, probablemente estoy resolviendo el problema desde el dato y no desde el trabajo (ver [Sección 2.1](#21-por-qué-este-orden-y-no-otro)).

Qué nunca asumir: que una tabla `[DISEÑADA]` en `docss/03` ya existe en el Sheet de producción; que el adapter `real` está completo; que el RBAC de gobierno ya salió de sandbox; que un módulo "futuro propuesto" tiene alcance decidido; que ocultar un botón alcanza como seguridad.

---

# 10. Cómo reconocer una solución correcta — ejemplos

## 10.1 Ejemplo bueno: consumo de MP en la OE

**Situación:** el operario de elaboración tiene que registrar qué materia prima usó.

**Solución correcta (la que el sistema ya implementa conceptualmente):** una pantalla guiada, un paso a la vez, que le pide escanear o elegir el lote. Si el lote no corresponde al MP del BOM, si está en cuarentena, si está vencido, o si la cantidad excede el saldo, el sistema **no deja guardar** y explica en una frase qué pasó y qué hacer ("Ese lote está en cuarentena: no se puede consumir. Elegí un lote liberado."). Al guardar, se genera automáticamente el movimiento de consumo con signo negativo — el operario nunca ve ni decide el signo.

**Por qué es correcta:** resuelve el trabajo real (cargar lo que usé) sin exponer al operario a la estructura de datos; previene el error en vez de permitirlo y corregirlo después; respeta append-only y estado derivado sin que el operario tenga que saberlo.

## 10.2 Ejemplo malo (tentador pero equivocado): pantalla de "gestión de inventario"

**Situación:** alguien propone una pantalla tipo Excel donde Supervisión pueda ver y editar libremente saldos por lote, "para tener control total cuando algo no cuadra".

**Por qué es una mala solución, aunque suene razonable:** permite editar `SALDOS` directamente, que es una caché derivada — rompe el principio de una sola fuente de verdad y hace posible que el saldo mostrado deje de coincidir con la suma real de movimientos, exactamente lo que la arquitectura existe para impedir. La solución correcta al problema real ("algo no cuadra") es un flujo de **ajuste** (`Ajuste +`/`Ajuste −`), que genera un movimiento nuevo, visible, auditable, con motivo y usuario — nunca una edición directa.

## 10.3 Ejemplo bueno: badge de estado de un lote

**Situación:** mostrar si un lote está apto para usarse.

**Solución correcta:** un badge con color del token semántico correspondiente + ícono + texto ("🟢 Liberado", "🟠 Cuarentena", "🔴 Rechazado"), siempre en el mismo lugar de la card, siempre el mismo color para el mismo significado en toda la app.

**Por qué es correcta:** permite reconocer sin leer, en menos de tres segundos, coherente con el objetivo central de UX del producto.

## 10.4 Ejemplo malo: "mejorar" el color según el contexto

**Situación:** alguien propone que en el Workspace de Dirección los estados "Cerrada" se muestren en verde "porque para Dirección, cerrado es bueno, es progreso".

**Por qué es una mala solución:** rompe la regla de oro del Design System (un significado = un color, siempre). Introduce ambigüedad: ahora verde a veces significa "aprobado por calidad" y a veces "cerrado administrativamente", y la persona tiene que empezar a interpretar el contexto en vez de reconocer de un vistazo — exactamente lo que el sistema de tokens existe para evitar.

## 10.5 Errores frecuentes al evaluar una propuesta nueva

- Evaluarla solo por si "funciona" técnicamente, sin preguntar si respeta la filosofía Trabajo→Estado→Acción→Datos.
- Aceptar una excepción a append-only "porque es un caso raro" — los casos raros son exactamente los que una inspección va a preguntar primero.
- Aprobar un componente visual nuevo "porque este caso es especial" sin pasarlo primero por el Design System.
- Asumir que porque el modelo de datos lo describe, ya existe conectado en el frontend real — siempre hay que verificar contra el estado real del código y de los Sheets, no contra la aspiración documentada.

---

# 11. Cómo trabajar con Cursor (o cualquier asistente de código) a lo largo del tiempo

## 11.1 Cómo debe usar este documento

Como el filtro mental que se aplica *antes* de escribir una línea de código, no como una referencia a consultar después de haber decidido algo. La secuencia correcta es: entender el pedido → pasar el test de la [Sección 3.1](#31-el-test-de-una-decisión) y el checklist de la [Sección 9](#9-checklist-de-toma-de-decisiones--antes-de-implementar-cualquier-cambio) → recién ahí planificar la implementación técnica.

## 11.2 Cómo debe interpretar las instrucciones

Las instrucciones de Agustina (o de quien lidere el producto en el futuro) siempre se interpretan a favor de la filosofía del producto, no literalmente al pie de la letra cuando hay tensión. Si una instrucción, tomada literalmente, generaría una mala solución en el sentido de la [Sección 10](#10-cómo-reconocer-una-solución-correcta--ejemplos), la respuesta correcta no es ejecutarla igual ni ignorarla — es señalar la tensión explícitamente y proponer la alternativa que sí respeta la filosofía, dejando la decisión final en manos de la persona.

## 11.3 Cómo debe desarrollar nuevas funcionalidades

Siempre ancladas a: una entidad, un estado, un rol responsable, y una acción. Si una funcionalidad nueva no puede describirse en esos términos, probablemente todavía no está lo suficientemente pensada como para empezar a construirla — hay que volver a la [Sección 2.1](#21-por-qué-este-orden-y-no-otro) y encontrar el "trabajo" real antes de tocar el "dato".

## 11.4 Cómo debe mantener consistencia con el resto del proyecto

Antes de crear cualquier cosa nueva (un componente, un endpoint conceptual, un estado, un color), buscar primero si ya existe algo equivalente en `docss/07` (Design System), `docss/18` (convenciones) o en el código ya escrito. Genus OS crece por reutilización disciplinada del mismo vocabulario, no por acumulación de soluciones puntuales — esa disciplina es, en gran medida, lo que hace que el sistema se sienta como un producto coherente y no como una colección de pantallas hechas por gente distinta en momentos distintos.

## 11.5 Cómo debe trabajar durante los próximos años

Con la misma actitud con la que se hizo el análisis que produjo este documento: leer antes de asumir, verificar la realidad del código y de los datos antes de confiar en la documentación de visión, preferir lo aditivo, preguntar ante la ambigüedad regulatoria, y nunca perder de vista que el objetivo final no es un sistema técnicamente elegante — es que una persona en Laboratorio Genus, cualquier día, abra el sistema y sepa, sin pensar, qué es lo próximo que tiene que hacer.

---

*Fin de la Parte I. Continúa en [`02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md`](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md).*
