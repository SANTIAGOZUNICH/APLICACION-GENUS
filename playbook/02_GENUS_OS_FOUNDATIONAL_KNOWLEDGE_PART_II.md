# GENUS_OS_FOUNDATIONAL_KNOWLEDGE — Parte II
### Criterio: cómo pensar Genus OS, no solo qué es

> Continuación de [`01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md`](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md) (Secciones 1–11). Ahí está el qué y el por qué. Acá está el cómo pensar cuando no hay una regla escrita para el caso que tenés adelante — que es, en la práctica, la mayoría de los días de trabajo real en un producto vivo.

---

## Índice

12. [Cómo debe sentirse Genus OS](#12-cómo-debe-sentirse-genus-os)
13. [Principios de experiencia — la personalidad del producto](#13-principios-de-experiencia--la-personalidad-del-producto)
14. [Cómo pensar una pantalla nueva — el proceso mental completo](#14-cómo-pensar-una-pantalla-nueva--el-proceso-mental-completo)
15. [Cómo pensar una funcionalidad nueva — de la necesidad a la implementación](#15-cómo-pensar-una-funcionalidad-nueva--de-la-necesidad-a-la-implementación)
16. [Framework de toma de decisiones](#16-framework-de-toma-de-decisiones)
17. [Antipatrones — todo lo que jamás debería aparecer en Genus OS](#17-antipatrones--todo-lo-que-jamás-debería-aparecer-en-genus-os)
18. [Cómo escribir código para Genus OS — filosofía de desarrollo](#18-cómo-escribir-código-para-genus-os--filosofía-de-desarrollo)
19. [Cómo evaluar una propuesta — framework de evaluación](#19-cómo-evaluar-una-propuesta--framework-de-evaluación)
20. [Cómo pensar como Product Architect de Genus OS](#20-cómo-pensar-como-product-architect-de-genus-os)
21. [El ADN de Genus OS](#21-el-adn-de-genus-os)

> Ver también [`04_GENUS_OS_EXECUTION_MANUAL.md`](./04_GENUS_OS_EXECUTION_MANUAL.md) para el procedimiento operativo tarea a tarea.

---

# 12. Cómo debe sentirse Genus OS

Las reglas de Design System dicen *qué* mostrar. Esta sección dice *qué debería sentir* la persona un segundo después de abrir la app, antes de leer una sola palabra. Si esa sensación está bien, casi cualquier decisión de UI posterior sale bien casi sola. Si está mal, ninguna cantidad de tokens correctos la va a salvar.

## 12.1 El operario (Cristian, Nicolás, Santino, Belén)

Tiene guantes puestos, probablemente ruido de planta alrededor, una tarea física esperando, y cero interés en "explorar la app". Cuando abre Genus OS debería sentir **alivio, no desafío**. La sensación correcta es la de alguien que llega a su puesto y ya está todo preparado para él: no "¿ahora qué hago?", sino "ah, esto". Nada de fricción de decisión. Si en algún momento el operario siente que tiene que *pensar* para entender qué tocar, la pantalla ya falló, sin importar qué tan lindo se ve el botón.

La sensación opuesta —la que nunca debe aparecer— es la de estar frente a un formulario burocrático que hay que completar para poder seguir trabajando. El sistema no debe sentirse como un trámite que se interpone entre el operario y su trabajo real (hacer la crema); debe sentirse como una extensión natural de ese trabajo, casi invisible.

**Impacto en UX:** de acá sale directamente la insistencia en objetos grandes, baja densidad, una sola acción visible, lenguaje de "cargá el lote que usaste" en vez de "registrar movimiento de consumo". No es estética: es la traducción literal de "alivio" a componentes.

## 12.2 El supervisor (Agustina, en el rol de `ROL-SU`)

Tiene que sentir **dominio sin esfuerzo**. No es que tenga menos que hacer que el operario —probablemente tiene más decisiones que tomar— pero esas decisiones deberían sentirse *servidas*, no *cazadas*. La sensación correcta: "sé exactamente qué está pasando en toda la planta sin haber tenido que preguntarle a nadie". Es la sensación de estar arriba de la operación, no adentro de ella luchando por entenderla.

Lo que nunca debe sentir: ansiedad por lo que no ve. Si el supervisor cierra la pantalla con la duda de "¿me estaré perdiendo algo?", el Workspace de Producción falló en su propósito central — que es precisamente sacarle esa ansiedad de encima mostrándole los problemas *antes* de que los tenga que buscar.

**Impacto en UX:** de acá sale la sección "Problemas" siempre visible y nunca colapsada por completo, el KPI que también es una entrada a su worklist, y la regla de que "esperando a otros" existe como categoría propia — para que el supervisor sepa con certeza qué ya no depende de él, sin tener que seguir vigilándolo.

## 12.3 Calidad (Santiago, en el rol de `ROL-CA`)

Tiene que sentir **rigor sin fricción**. Su trabajo es literalmente juzgar si algo cumple o no — eso exige atención y cuidado, nunca apuro. Pero la fricción que tiene que sentir es la fricción *del juicio profesional que está ejerciendo*, no la fricción de pelearse con el sistema para encontrar la evidencia que necesita para decidir. Cuando abre un lote en cuarentena, toda la evidencia relevante tiene que estar servida al lado, no repartida en media docena de pestañas que hay que ir a buscar.

Lo que nunca debe sentir: que el sistema lo apura a decidir. Ningún elemento visual debe empujar a Calidad hacia "aprobar rápido" — la app puede (y debe) mostrarle antigüedad y urgencia de la cola, pero jamás debe hacer que aprobar se sienta más fácil o más rápido que rechazar. Esa neutralidad de fricción entre las dos decisiones es, en sí misma, un principio de integridad del producto.

**Impacto en UX:** de acá sale que la cola de cuarentena se ordene por antigüedad (no por facilidad), que la evidencia esté al lado de la decisión sin necesidad de navegar, y que "Liberado" y "Rechazado" tengan exactamente el mismo peso visual — ningún botón verde más grande que el rojo.

## 12.4 Dirección Técnica (Farm. Caio David Zunich, `ROL-DT`)

Tiene que sentir **el peso exacto del acto que está por hacer, ni más ni menos**. Firmar una liberación es un acto legal — la interfaz tiene que transmitir eso sin volverlo pesado en el sentido de "trabado" o "burocrático". Es la diferencia entre una confirmación que dice "¿Confirmás?" en general, y una que dice exactamente qué se está firmando y sobre qué evidencia — para que la firma sea un acto informado, no un click reflejo.

Lo que nunca debe sentir: que firmar es "una tarea más de la cola". Es cualitativamente distinta de cualquier otra acción del sistema —es la única acción con la letra F, la única con consecuencia legal directa— y su presentación visual debería reflejar ese peso distintivo (por ejemplo, siempre con un paso de confirmación explícito que resuma qué se va a firmar, nunca un botón que se comporte igual que "Cerrar OE").

## 12.5 Dirección (visión ejecutiva)

Tiene que sentir **calma cuando todo está bien, y alarma inmediata cuando no**. Su Workspace es, por diseño, un buzón de excepciones — vacío es la mejor noticia posible, y tiene que sentirse como una buena noticia (empty state positivo, no una pantalla en blanco que parece un error). Cuando hay algo, tiene que saltar a la vista sin necesidad de leer con atención.

**Impacto en UX:** justifica por qué Dirección es la única misión donde "Excepciones" es literalmente la sección principal y "Panorama" es secundario — invertido respecto a cómo cualquier ERP tradicional pondría primero el dashboard de KPIs.

## 12.6 El hilo común

En los cinco casos la emoción objetivo tiene el mismo nombre distinto de disfraz: **confianza**. Confianza de que el sistema ya hizo el trabajo de organizar, priorizar y avisar, para que la persona pueda dedicar su atención exclusivamente a lo que solo un humano puede hacer — ejecutar, decidir, juzgar, firmar. Cada decisión de UX que se evalúa debería, al final, responderse contra esta pregunta: ¿esto suma o resta a esa confianza?

---

# 13. Principios de experiencia — la personalidad del producto

Un producto, igual que una persona, tiene una personalidad que se percibe incluso en los detalles más chicos. La de Genus OS no es opcional ni decorativa — nace directamente de que es software crítico dentro de un entorno regulado, usado por personas con poco tiempo y mucha responsabilidad.

**Rápido.** No significa "con animaciones veloces". Significa que entre que la persona tiene una intención y el sistema la ejecuta, hay el mínimo de pasos posible. Rápido es sinónimo de "no me hagas perder tiempo decidiendo cosas que vos ya podés saber por mí". Un formulario de tres pantallas para consumir un lote no es lento por su animación, es lento porque le pide al operario decisiones que el sistema ya podría haber pre-resuelto.

**Claro.** Nunca ambiguo sobre qué significa algo o qué pasa si tocás algo. Claro significa que un desconocido total del sistema, mirando una pantalla por primera vez, puede deducir correctamente qué es lo urgente y qué tiene que hacer, sin manual. Si hace falta un tooltip para explicar qué significa un color, ese color ya está mal elegido.

**Silencioso.** No grita para llamar la atención salvo cuando de verdad hay algo urgente. Un sistema que usa rojo, badges parpadeantes o notificaciones constantes para todo, entrena a la persona a ignorarlas — exactamente lo contrario de lo que un sistema de alertas GMP necesita. El silencio es lo que le da autoridad al rojo cuando aparece: si todo grita, nada se escucha.

**Confiable.** En el sentido más literal: lo que el sistema muestra es exactamente lo que pasó, sin excepción, sin "a veces se desactualiza" ni "hay que refrescar para estar seguro". Esto no es una aspiración de UX, es una consecuencia directa de append-only y estados derivados — la confiabilidad *sentida* del producto depende enteramente de la disciplina de arquitectura de la Parte I.

**Consistente.** Un componente significa lo mismo en cualquier pantalla donde aparezca, sin excepciones "porque acá es distinto". La consistencia es lo que permite que aprender a usar Genus OS una vez sirva para siempre — es, literalmente, lo que ahorra la curva de aprendizaje que un ERP tradicional le impone a cada usuario nuevo.

**Profesional.** No significa "corporativo" ni "serio al punto de ser frío". Significa que transmite que quien lo construyó entiende la seriedad del trabajo que hace posible — un laboratorio GMP no es un contexto para gamificación, badges de logros ni tonos casuales de app de consumo. Profesional es la versión de "cuidado" que corresponde a este dominio.

**Predecible.** La misma acción, en el mismo estado, produce siempre el mismo resultado, en el mismo lugar de la pantalla. Predecible es lo que permite que un operario, después de la primera semana, deje de mirar la pantalla con atención consciente y empiece a operar casi por reflejo — que es, de hecho, el objetivo final de error-proofing: no que la persona sea más cuidadosa, sino que el sistema haga innecesario ese cuidado extra.

## Qué nunca debe sentirse

- **Nunca lúdico o gamificado.** Este no es un producto de consumo que compite por atención; es una herramienta de trabajo crítico. Confeti, insignias, rachas de días — no tienen lugar acá, sin importar cuánto "aumenten el engagement" en abstracto.
- **Nunca ansioso.** Un sistema que multiplica alertas, badges rojos y contadores sin discriminar urgencia real entrena a la persona a vivir en alerta constante — lo opuesto de calma y confiable.
- **Nunca infantilizante.** El lenguaje simple ("cargá el lote que usaste") no es lenguaje condescendiente. Hay una línea fina entre hablarle claro a un profesional y hablarle como si no entendiera su propio trabajo — la segunda rompe la confianza tan rápido como la jerga técnica innecesaria.
- **Nunca opaco sobre por qué algo no se puede hacer.** Un botón deshabilitado sin explicación genera desconfianza ("¿está roto? ¿no tengo permiso? ¿por qué?"). Siempre tiene que quedar claro el motivo.
- **Nunca "creativo" en su vocabulario visual.** La creatividad en Genus OS vive en cómo se resuelve un flujo, nunca en inventar un color o un ícono nuevo para "diferenciarse". La marca se construye por consistencia acumulada, no por sorpresas visuales.

---

# 14. Cómo pensar una pantalla nueva — el proceso mental completo

## 14.1 Cómo empezar

Nunca por el layout. Nunca por "qué componentes necesito". Se empieza escribiendo, en una frase, la respuesta a: **¿qué trabajo resuelve esta pantalla, para quién, y cuál es la única acción que de verdad importa acá?** Si no se puede escribir esa frase con claridad, todavía no es momento de diseñar la pantalla — falta entender el problema.

Ejemplo de frase de partida válida: *"Esta pantalla existe para que Calidad decida, sobre un lote en cuarentena, si lo libera o lo rechaza, con toda la evidencia necesaria al lado."* Esa frase ya casi dicta la estructura: identidad del lote arriba, evidencia en el cuerpo, dos acciones de igual peso (liberar/rechazar) abajo.

## 14.2 Qué preguntas hacerse, en orden

1. ¿A qué rol pertenece esta pantalla, y qué siente esa persona al llegar acá ([Sección 12](#12-cómo-debe-sentirse-genus-os))?
2. ¿En qué estados puede estar la entidad principal de esta pantalla, y hay una acción distinta —o ninguna— para cada estado?
3. ¿Qué datos son estrictamente necesarios para que la persona pueda ejecutar esa acción con criterio? (No "qué datos existen en la tabla" — qué datos hacen falta para *esta* decisión puntual.)
4. ¿Esta pantalla se llega desde una tarea (lo correcto) o es un punto de entrada suelto tipo menú (sospechoso)?
5. ¿Qué componentes del Design System ya resuelven esto? ¿Hace falta inventar algo, o ya existe la pieza?
6. ¿Cuál es el estado vacío, y se siente positivo?
7. ¿Qué pasa si la persona se equivoca acá? ¿El sistema previene el error antes de guardar, o lo permite y lo corrige después?

## 14.3 Cómo decidir cuando hay dos layouts posibles

Se aplica el mismo criterio de desempate de la Sección 3.2 de la Parte I, con un agregado específico de pantalla: **entre dos layouts igual de correctos funcionalmente, gana el que tiene menos elementos compitiendo por atención.** Si al mirar el wireframe hay dos cosas igual de grandes o igual de saturadas en color, todavía no está terminado — falta decidir cuál es el verdadero foco y bajarle jerarquía visual a todo lo demás.

## 14.4 Cómo saber si una pantalla está bien diseñada

Test rápido, aplicable a cualquier pantalla terminada: mostrársela tapada a alguien que no trabaja en el proyecto, destaparla tres segundos, taparla de nuevo, y preguntar "¿qué era lo urgente, y qué había que hacer?". Si la persona responde bien, la pantalla pasó el test central del producto (`docss/00` §9: "en menos de tres segundos"). Si duda, hay ruido visual, jerarquía ambigua, o más de una acción primaria compitiendo.

Otras señales de que está bien diseñada: se puede describir de memoria sin mirarla ("arriba el foco grande, después problemas, después lo demás colapsado"); no necesita texto de ayuda para entenderse; el color usado ahí ya existe en el sistema de tokens sin excepción.

## 14.5 Cómo detectar que una pantalla rompe la filosofía

- Tiene más de una acción primaria visible al mismo tiempo.
- Muestra una tabla como primer contacto, en vez de cards de trabajo.
- Obliga a filtrar o buscar para encontrar lo urgente, en vez de mostrarlo arriba ya ordenado.
- Usa un color fuera de los cinco tokens, "solo por esta vez".
- El texto de ayuda es más largo que lo que debería explicar por sí sola con buen diseño.
- La persona que la usa todos los días la sigue mirando con atención consciente después de un mes — señal de que no se volvió predecible.

## 14.6 Cómo iterarla

Nunca agregando — primero preguntando qué se puede sacar. La iteración por defecto en Genus OS es de reducción, no de acumulación: cada elemento nuevo que se agrega a una pantalla debe justificar por qué no puede resolverse quitando otra cosa primero. Cuando una pantalla "se siente cargada" después de varias iteraciones agregando funcionalidad, la solución casi nunca es reorganizar — es preguntarse qué de lo que ya está ahí dejó de ser el foco real y puede moverse a una sección secundaria o directamente eliminarse.

---

# 15. Cómo pensar una funcionalidad nueva — de la necesidad a la implementación

## 15.1 El origen de una necesidad real (vs. una necesidad inventada)

Una necesidad real en Genus OS casi siempre nace de una de estas tres fuentes, y es importante distinguir cuál es porque cambia cómo se valida:

- **Una persona real tropieza con algo repetidamente.** ("Todos los días tengo que preguntarle a Calidad si ya analizó mi granel.") Esta es la fuente más confiable: hay una fricción observada, no imaginada.
- **Un requisito regulatorio lo exige.** ("ANMAT pide poder reconstruir cuándo se capacitó a cada operario en un POE vigente.") Esta fuente no se negocia por prioridad de producto — si es regulatorio, se hace, aunque no sea "lo más emocionante de construir".
- **Una inconsistencia del sistema lo revela.** ("El material de empaque no se registraba por lote" — el hueco histórico de la Sección 4.4 de la Parte I.) Esta fuente aparece al auditar el propio modelo contra la operación real, no al pedir feedback.

Lo que **no** es una fuente confiable: una funcionalidad que "estaría buena tener" sin que nadie la haya pedido ni la falta de ella haya generado fricción observable. Ese tipo de necesidad casi siempre es, en el fondo, entusiasmo técnico disfrazado de necesidad de producto — hay que sospechar de ella activamente.

## 15.2 El proceso, paso a paso

1. **Nombrar el trabajo, no la funcionalidad.** No "necesitamos notificaciones push" — sino "el supervisor necesita enterarse en el momento en que Calidad libera un granel, para poder crear la OA sin perder tiempo revisando manualmente". La funcionalidad (notificaciones) es una posible solución; el trabajo (enterarse a tiempo) es el problema real. Nombrar bien el trabajo a veces revela que la solución correcta no es la que se pensó primero.
2. **Verificar si ya existe una solución parcial.** Antes de proponer algo nuevo, preguntar si el vocabulario ya existente (una sección de Workspace, un estado, una acción) ya resuelve el 80% del problema con un ajuste chico, en vez de una funcionalidad nueva entera.
3. **Ubicarla en la cadena Trabajo→Estado→Acción→Datos.** ¿A qué entidad y estado se ancla? Si no se puede anclar a ninguno, probablemente todavía no está bien definida.
4. **Preguntar qué principio no negociable toca**, y verificar que no lo rompe (Sección 8, Parte I).
5. **Estimar el costo de *no* hacerla.** Si el costo de no tenerla es bajo (alguien pierde dos minutos ocasionalmente) y el costo de construirla es alto (nueva tabla, nuevas automatizaciones), probablemente no vale la pena todavía — ver el framework de priorización de la [Sección 16](#16-framework-de-toma-de-decisiones).
6. **Diseñarla como parte del vocabulario existente**, no como una isla — debería poder describirse usando los mismos conceptos (Workspace, sección, card, badge, acción primaria) que todo lo demás.

## 15.3 Qué evitar

- Diseñar la funcionalidad pensando en el caso ideal y dejando el caso de error para "después" — el error-proofing es parte del diseño desde el principio, no un parche.
- Construir configurabilidad genérica para un problema específico ("hagamos que el umbral de stock crítico sea configurable por cualquier campo, por si en el futuro se necesita otra cosa") — es sobre-ingeniería que agrega superficie de mantenimiento sin beneficio real hoy.
- Aceptar el primer nombre que alguien le puso a la funcionalidad sin cuestionar si describe bien el trabajo real (ver 15.2.1).

## 15.4 Cómo decidir si de verdad vale la pena implementarla ahora

Tres preguntas, en orden, y basta con que una responda "no" para posponerla:

1. ¿Resuelve una fricción real, medible, de alguien que ya usa el sistema hoy — o es una hipótesis sobre el futuro?
2. ¿Se puede construir de forma aditiva, sin tocar nada `[VERIFICADA]` de forma no aditiva?
3. ¿El costo de construirla ahora es menor que el costo acumulado de seguir sin ella durante el tiempo que tomaría construir lo que sí es prioritario primero (según el roadmap vigente, `docss/14`)?

---

# 16. Framework de toma de decisiones

Cuando existen varias soluciones posibles, se evalúan en este orden estricto — cada capa solo desempata si la anterior no alcanzó para decidir:

## Capa 0 — Lo no negociable (filtro de entrada, no de desempate)

Antes de comparar soluciones entre sí, cada una se filtra individualmente contra la Sección 8 de la Parte I. Cualquier solución que rompa un principio no negociable **queda descartada acá**, sin importar cuán buena sea en las capas siguientes. Esto no es parte del ranking — es un veto.

## Capa 1 — Impacto en la persona real

De las soluciones que sobrevivieron la Capa 0: ¿cuál reduce más la carga cognitiva de la persona que la va a usar todos los días? Se prioriza siempre al que menos elección tiene sobre usar el sistema (el operario, que tiene que usarlo porque es su trabajo) por sobre al que más elección tiene (Dirección, que puede optar por preguntarle a alguien en vez de mirar la pantalla).

## Capa 2 — Coherencia con lo existente

¿Cuál reutiliza más vocabulario ya establecido (Design System, Workspaces, convenciones de `docss/18`) y menos inventa de cero? Ante empate de impacto, gana la que menos superficie nueva introduce.

## Capa 3 — Reversibilidad

¿Cuál es más fácil de deshacer si resulta ser una mala decisión? Se prefiere lo reversible sobre lo irreversible cuando hay incertidumbre real sobre si la solución es correcta — no por cobardía, sino porque en un producto que recién está madurando su conexión con datos reales (Sección 5 del `03_GENUS_OS_CURSOR_PLAYBOOK.md`), la certeza sobre qué es "correcto" todavía es baja en varias áreas.

## Capa 4 — Costo y velocidad

Solo acá entra el argumento de "esto es más rápido de construir". Es deliberadamente la última capa: la velocidad de desarrollo es el criterio menos importante de todos, porque una solución rápida que rompe algo de las capas anteriores termina costando más tiempo (y más riesgo regulatorio) del que ahorró.

## Qué nunca puede negociarse, bajo ningún argumento de negocio

- Append-only de `MOVIMIENTOS` y `LIBERACIONES`.
- Segregación de funciones (firmante ≠ cerrador).
- Las dos barreras de liberación.
- Autorización del lado servidor.
- Un significado = un color.

## Cómo priorizar entre varias funcionalidades igualmente válidas

Se usa el mismo orden que ya define el roadmap del proyecto (`docss/14`, buckets A–E): experiencia visible y de bajo riesgo primero, después lo que ayuda directamente al operario, después lo computado, y solo después la arquitectura profunda (`TAREAS`, automatizaciones). No es un criterio inventado para este framework — es el mismo criterio de gestión de riesgo aplicado consistentemente: lo reversible y perceptible antes que lo estructural e invisible.

## Cómo justificar una decisión, por escrito, cuando alguien pregunte "¿por qué así?"

La justificación completa siempre tiene esta forma: *"Elegimos [solución] en vez de [alternativa] porque [alternativa] rompía/arriesgaba [principio de la Capa 0 o Capa 1], y [solución] resuelve [el trabajo real identificado] reutilizando [vocabulario existente], con el costo de [trade-off aceptado explícitamente]."* Si no se puede completar esa frase con honestidad, probablemente la decisión no está bien fundamentada todavía.

---

# 17. Antipatrones — todo lo que jamás debería aparecer en Genus OS

Cada uno con el motivo real detrás, no solo la prohibición.

**Tablas como superficie de trabajo.** Obligan a la persona a interpretar filas y columnas para deducir qué hacer — es exactamente el trabajo cognitivo que el sistema existe para eliminar. Una tabla comunica dato; nunca comunica "qué hacer ahora". Las tablas siguen existiendo en Genus OS, pero exclusivamente como destino de consulta/auditoría, nunca como punto de partida de una tarea.

**Formularios interminables.** Cada campo adicional es una decisión más que la persona tiene que tomar antes de poder avanzar. Un formulario largo también oculta el error: cuanto más tarda en llegar la validación, más lejos está el momento del error del momento en que se cometió, y más difícil es para la persona relacionar uno con otro. El formulario guiado (un paso, revelado progresivo) existe precisamente para nunca mostrar más de lo que el paso actual necesita.

**Colores arbitrarios.** Cada color fuera del sistema de cinco tokens es una promesa rota: la promesa de que el color siempre significa lo mismo. Una vez que esa promesa se rompe una vez, deja de ser confiable en todos lados, no solo en el lugar donde se rompió — la persona empieza a tener que leer el texto para confirmar lo que el color debería haberle dicho de un vistazo.

**Múltiples acciones primarias.** Cuando hay dos botones azules en la misma pantalla, el sistema le devuelve al usuario exactamente la decisión que la filosofía Trabajo→Estado→Acción existe para resolverle. Si de verdad hay dos acciones igual de válidas (como liberar/rechazar en Calidad), la solución no es "dos primarias" — es dos acciones de **igual peso visual explícito**, no dos primarias compitiendo silenciosamente.

**Navegación confusa.** Cualquier estructura de navegación que no sea "Workspace de mi misión → secciones canónicas → cards" introduce una segunda gramática que hay que aprender aparte, rompiendo la promesa de que aprender un Workspace sirve para entenderlos todos.

**Componentes duplicados.** Dos botones que se ven distinto pero significan lo mismo, o dos badges con distinto estilo para el mismo estado, son la evidencia visible de que en algún punto alguien no revisó si ya existía la pieza antes de crear una nueva. Cada duplicado es una futura inconsistencia esperando a manifestarse cuando alguien actualice uno y se olvide del otro.

**Pantallas genéricas.** Una pantalla "de propósito general" que intenta servir para varios trabajos distintos casi siempre termina sirviendo mal a todos ellos, porque la gramática de card y la jerarquía visual dependen de saber exactamente qué trabajo se está resolviendo ([Sección 14.1](#141-cómo-empezar)). "Genérico" y "claro" son objetivos que compiten entre sí en este producto.

**Exceso de configuración.** Configurabilidad que nadie pidió, agregada "por si acaso", es deuda técnica disfrazada de flexibilidad. Cada opción configurable es una decisión más que alguien tiene que tomar (rompe "rápido" y "claro" de la Sección 13) y una superficie más de estados posibles para mantener y testear.

**Lógica escondida.** Cualquier regla de negocio crítica que viva solo en el cliente, o solo en un componente aislado sin reflejo en el modelo, es lógica que puede divergir silenciosamente de la fuente de verdad. Toda regla crítica tiene que poder señalarse: "esto vive acá, en la tabla o en la validación del servidor", nunca "esto está hardcodeado en este botón".

**Datos antes que trabajo.** El antipatrón raíz, del que casi todos los demás son una manifestación distinta. Cada vez que una pantalla nueva empieza preguntando "¿qué campos tengo que mostrar?" en vez de "¿qué trabajo resuelve esto?", el resultado tiende a converger, tarde o temprano, en alguno de los antipatrones de arriba.

---

# 18. Cómo escribir código para Genus OS — filosofía de desarrollo

**Reutilizar antes que crear.** Cada vez que aparece la tentación de escribir un componente, un handler o un mapper nuevo, la primera pregunta es si ya existe algo que resuelve el 80% del problema. El costo de reutilizar algo imperfecto casi siempre es menor que el costo acumulado de mantener dos soluciones parecidas que divergen con el tiempo — que es exactamente el antipatrón de "componentes duplicados" de la Sección 17, visto desde el lado del código en vez del lado visual.

**Extender antes que reemplazar.** El propio `docss/16` lo dice explícitamente sobre el backend, pero el principio es más general: asumir, por defecto, que lo que existe está como está por una razón, y que la forma correcta de mejorarlo es agregarle una capacidad nueva, no rehacerlo. Reemplazar algo que funciona introduce riesgo (¿la nueva versión cubre todos los casos que la vieja ya resolvía, incluidos los que nadie documentó?) a cambio de un beneficio casi siempre estético.

**Evolucionar antes que reescribir.** Una reescritura completa promete "esta vez lo hacemos bien", pero en la práctica descarta todo el conocimiento acumulado en los bordes y casos raros de la versión anterior — conocimiento que en un dominio GMP frecuentemente *es* la razón de cumplimiento, no deuda técnica. La evolución incremental, aunque menos satisfactoria de escribir, preserva ese conocimiento acumulado paso a paso.

**Simplicidad antes que sofisticación.** El código de este proyecto le habla, en última instancia, a alguien en planta que nunca va a ver ese código pero cuya experiencia depende de que funcione exactamente como se espera, todo el tiempo. Una abstracción elegante que introduce un caso borde sutil es más peligrosa acá que en un proyecto donde el peor resultado de un bug es una mala experiencia — acá el peor resultado puede ser un lote mal trazado. La sofisticación técnica se justifica solo cuando resuelve un problema real que la simplicidad no puede resolver, nunca por preferencia estética del que programa.

**Claridad antes que abstracción.** Una función que se lee y se entiende sin tener que saltar a otros tres archivos vale más, en este proyecto, que una arquitectura perfectamente desacoplada que nadie puede seguir mentalmente. Esto no es anti-arquitectura — es una preferencia explícita por abstracciones que reflejan directamente el vocabulario del dominio (Lote, OE, OA, Liberación) en vez de abstracciones genéricas de ingeniería que hay que traducir mentalmente de vuelta al dominio cada vez que se leen.

## El hilo común de estos cinco principios

Todos apuntan al mismo lugar: el código de Genus OS no es un fin en sí mismo, es el medio para sostener una promesa hecha a personas reales ([Sección 12](#12-cómo-debe-sentirse-genus-os)). Cada decisión técnica que prioriza la elegancia del código por sobre la previsibilidad del comportamiento está invirtiendo mal la prioridad, en este dominio específico.

---

# 19. Cómo evaluar una propuesta — framework de evaluación

Cuando alguien (Agustina, Dirección Técnica, un desarrollador, otra IA) propone una funcionalidad nueva, la evaluación sigue esta secuencia. Cada pregunta que responde "no" o "no sé" detiene el avance hasta resolverla — no se sigue evaluando "por las dudas".

1. **¿Puedo nombrar el trabajo real que resuelve, en una frase, sin usar la palabra "funcionalidad"?** Si no, pedir que se reformule antes de seguir evaluando.
2. **¿A qué rol, entidad y estado se ancla?** Si la propuesta es transversal a todo el sistema sin anclaje concreto, sospechar — casi siempre es una buena idea en abstracto pero prematura en concreto.
3. **¿Rompe algún principio no negociable de la Sección 8 (Parte I)?** Aplicar la lista explícitamente, uno por uno, nunca de memoria ni por impresión general.
4. **¿Puede construirse de forma aditiva?** Si no, ¿la persona que decide (Agustina, o Dirección Técnica si hay implicancia regulatoria) está al tanto explícitamente de que no lo es?
5. **¿Reutiliza vocabulario existente del Design System y de los Workspaces, o inventa uno nuevo?** Si inventa uno nuevo, ¿está justificado por qué lo existente no alcanza?
6. **¿El costo de construirla ahora compite con algo de mayor prioridad según el roadmap vigente?** ([Sección 16](#16-framework-de-toma-de-decisiones), "cómo priorizar".)
7. **¿Qué pasaría si esto no se hiciera nunca?** Si la respuesta es "nada grave", la propuesta probablemente puede esperar, sin importar cuán interesante sea de construir.
8. **¿La propuesta mejora una de las sensaciones objetivo de la Sección 12, o las degrada sin que nadie lo haya notado todavía?** (Por ejemplo: una propuesta que agrega más alertas visibles puede sentirse como "más información", pero degradar la sensación de calma que el sistema le debe a Dirección.)

## Cómo saber si es una buena idea

Una buena idea, evaluada con este framework, generalmente pasa las ocho preguntas sin necesidad de forzar ninguna respuesta. Si hace falta "estirar" la justificación en más de una pregunta para que encaje, probablemente la idea es razonable en general pero no está lista todavía en su forma actual — vale la pena reformularla, no descartarla de plano ni forzarla.

## Cómo saber si rompe Genus OS

Rompe Genus OS cualquier propuesta que, aceptada, obligue a una futura excepción documentada a uno de los principios no negociables, o que introduzca una segunda forma de hacer algo que el sistema ya resolvía de una sola forma consistente. La señal más confiable de que algo rompe el producto no es que "se vea mal" — es que **crea una inconsistencia que alguien va a tener que explicar más adelante**.

---

# 20. Cómo pensar como Product Architect de Genus OS

Este es el capítulo que intenta transmitir, no reglas, sino una forma de mirar. Se aprende observando el patrón detrás de cada decisión anterior de este documento, no memorizando cada una por separado.

## 20.1 El movimiento mental base: bajar siempre al trabajo real antes de subir a la solución

Cada vez que aparece un problema, la tentación natural (más fuerte cuanto más técnico es quien lo enfrenta) es saltar directo a una solución técnica. Pensar como Product Architect de este proyecto significa resistir ese salto, bajar primero al nivel de "¿qué persona, haciendo qué, en qué momento, siente esta fricción exactamente?", y solo después de tener esa respuesta clara, subir de nuevo hacia una solución. Este movimiento — bajar antes de subir — es el que atraviesa cada sección de este documento, desde "cómo pensar una pantalla" hasta "cómo evaluar una propuesta".

## 20.2 Cómo cuestionar sin paralizar

Cuestionar en este proyecto no significa objetar todo por sistema. Significa hacerse, ante cada decisión —propia o ajena— la pregunta honesta de "¿esto es así porque hay una razón real, o porque es lo primero que se nos ocurrió y quedó así?". La mayoría de las veces la respuesta va a ser "hay una razón real" (especialmente en el backend, ver Sección 5.1 de la Parte I) — y ahí el trabajo de Product Architect es identificar esa razón y documentarla, no cuestionarla indefinidamente. Pero cuando la respuesta es "quedó así porque sí", ahí es donde vale la pena invertir tiempo en repensar.

## 20.3 Cómo validar sin depender solo de la intuición

La intuición de producto de este documento viene de haber cruzado tres fuentes (visión documentada, código real, operación real) — nunca de una sola. Pensar como Product Architect acá significa desconfiar de cualquier conclusión que se apoye en una sola fuente: si `docss/` dice que algo existe pero el código no lo confirma, la conclusión correcta no es "confío en la documentación" ni "confío en el código" — es ir a verificar directamente, como se hizo en la auditoría de fidelidad de `03_GENUS_OS_CURSOR_PLAYBOOK.md`. Esa triangulación constante entre lo que se dijo, lo que se construyó y lo que pasa en la realidad operativa es, en la práctica, la herramienta de validación más poderosa disponible en este proyecto.

## 20.4 Cómo descubrir problemas antes de que alguien los reporte

Los problemas más valiosos de encontrar en Genus OS no son los que alguien reporta ("esto no funciona") sino los que se descubren cruzando fuentes — como el hueco del lote de material de empaque, que no lo reportó nadie como bug: se descubrió comparando lo que el modelo idealizado asumía con lo que realmente pasaba en planta. Pensar como Product Architect significa mantener activo ese hábito de cruce constante: cada vez que se lee un documento nuevo, una hoja de cálculo real, o una parte del código, preguntarse "¿esto es coherente con lo que ya sé, o hay una grieta acá que todavía nadie notó?".

## 20.5 Cómo detectar oportunidades sin inflar el alcance

Ver una oportunidad de mejora es fácil; la disciplina está en no perseguir todas al mismo tiempo. El criterio: una oportunidad vale la pena señalarla en el momento en que se descubre (para que quede registrada, no se pierda), pero solo vale la pena perseguirla activamente cuando pasa el framework completo de la [Sección 19](#19-cómo-evaluar-una-propuesta--framework-de-evaluación) — incluida la pregunta de si compite con algo de mayor prioridad ya en curso.

## 20.6 Cómo evolucionar el producto sin perder su identidad

La evolución correcta de Genus OS a lo largo del tiempo no es "agregar funcionalidades" sino "acercar cada vez más la realidad operativa (Excel sueltos, Word por producto) al modelo idealizado (`docss/03`), sin romper nunca la experiencia de las personas que ya confían en el sistema tal como está". Cada paso de esa evolución debería poder explicarse como una reducción de la distancia entre visión y realidad (Sección 5 del `03_GENUS_OS_CURSOR_PLAYBOOK.md`), nunca como una desviación nueva respecto a la visión original.

---

# 21. El ADN de Genus OS

Si en diez años cambia completamente la tecnología —otro framework, otro lenguaje, quizás ni siquiera una interfaz web tradicional— esto es lo que debería seguir siendo exactamente igual, porque no es tecnología: es la razón de ser del producto.

**El trabajo siempre antes que el dato.** No importa cómo se implemente técnicamente en el futuro — la experiencia siempre debe empezar en "esto es lo que tenés que hacer", nunca en "esto es lo que existe en el sistema".

**Ninguna persona debería tener que recordar el estado de algo — el sistema se lo recuerda a ella.** Esto es independiente de si el "sistema" en el futuro usa IA, reglas simples, o cualquier otra tecnología: la responsabilidad de saber en qué estado está algo nunca vuelve a caer sobre la memoria humana.

**El registro de lo que pasó nunca se altera, solo se completa.** Append-only no es una elección de base de datos — es una postura ante la verdad: lo que pasó, pasó, y se corrige agregando información nueva, nunca borrando la vieja. Esto sobrevive a cualquier stack técnico.

**Quien produce nunca se autoaprueba.** La segregación de funciones no es una regla de software — es un principio de gobernanza que existía antes del sistema y va a seguir existiendo después, con o sin este código específico.

**Un significado, una señal, siempre.** Sea color, ícono, sonido o cualquier otra forma de comunicar estado que la tecnología del futuro permita, la regla de fondo no cambia: cada señal comunica exactamente una cosa, siempre la misma, en todas partes.

**El sistema se gana la confianza siendo predecible antes que siendo impresionante.** Genus OS nunca compitió, ni debería competir, por ser el software más innovador visto por primera vez — compite por ser el software que, después de usarlo mil veces, nunca sorprendió a nadie de mala manera.

**La complejidad regulatoria se absorbe en el sistema, no se traslada a la persona.** Cuanto más complicado es cumplir GMP correctamente, más simple debería sentirse para quien lo ejecuta día a día — esa inversión (absorber complejidad en vez de trasladarla) es, en el fondo, la propuesta de valor entera del producto, resumida en una frase.

Si algún día una decisión nueva parece coherente con la tecnología del momento pero entra en conflicto con alguno de estos siete puntos, la decisión correcta —sin importar cuánto tiempo haya pasado desde que se escribió este documento— es priorizar el ADN por sobre la tendencia técnica de turno. Eso es, en definitiva, lo que hace que algo siga siendo *Genus OS* aunque todo lo demás alrededor haya cambiado.

---

*Fin de la Parte II. Junto con la Parte I, este documento no pretende ser leído una sola vez — pretende ser el filtro con el que se lee y se decide todo lo demás, indefinidamente. Continúa en [`03_GENUS_OS_CURSOR_PLAYBOOK.md`](./03_GENUS_OS_CURSOR_PLAYBOOK.md) (estado real del proyecto) y [`04_GENUS_OS_EXECUTION_MANUAL.md`](./04_GENUS_OS_EXECUTION_MANUAL.md) (procedimiento operativo).*
