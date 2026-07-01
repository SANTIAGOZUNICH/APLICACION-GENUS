# 00 — Visión general

Documento conceptual. Define **qué es Genus y por qué existe** antes de cualquier detalle técnico. Todo lo demás (modelo, módulos, front-end) debe ser coherente con esta filosofía.

---

## 1. Qué es Genus

Genus Operaciones es el sistema nervioso de un laboratorio cosmético GMP. No es "una app de stock" ni "una planilla mejorada": es la representación digital del **proceso productivo completo**, desde que un cliente hace un pedido hasta que el producto terminado, liberado por calidad, sale despachado, con cada lote trazable hacia atrás hasta sus materias primas.

Genus tiene dos capas conceptuales:

1. **El motor operativo (backend):** el registro fiel, append-only y auditable de todo lo que ocurre — recepciones, consumos, producciones, controles, liberaciones, despachos. Es la fuente de verdad GMP.
2. **La experiencia (frontend):** la forma en que cada persona del laboratorio interactúa con ese motor. La visión es que esta capa sea un **asistente**, no una base de datos navegable.

## 2. La filosofía del sistema

La filosofía se resume en una frase que el sistema le dice a cada usuario:

> **"Esto es lo próximo que tenés que hacer."**

El usuario no debe preguntarse nunca *"¿a qué módulo entro?"* ni *"¿en qué tabla está esto?"*. El sistema conoce el estado de todas las operaciones y quién es responsable de cada cosa; por lo tanto, **puede y debe** decirle a cada persona qué sigue.

Principios rectores:

- **Claridad sobre densidad** — mostrar lo necesario, no todo lo posible.
- **Consistencia absoluta** — un mismo componente significa lo mismo en todas partes.
- **Reconocer, no recordar** — el estado se ve (color + ícono), no se memoriza.
- **Una acción primaria por contexto.**
- **El estado guía** — el color comunica significado, jamás decora.
- **A prueba de error** — la validación frena el error antes de que ocurra; la confirmación protege lo irreversible.
- **Pensado para planta** — alto contraste, objetos grandes, lenguaje simple.

## 3. Qué significa "ERP guiado por tareas"

Un ERP tradicional se organiza por **módulos** (tipos de dato): Inventario, Producción, Ventas. El usuario tiene que saber en qué módulo está lo que necesita y navegar hasta ahí. El sistema es pasivo: espera (*pull*).

Un **ERP guiado por tareas** se organiza por **trabajo** (estado de las operaciones). El usuario abre la app y recibe directamente su lista de tareas pendientes, priorizada. El sistema es activo: reparte (*push*).

La diferencia es de *dónde empieza el usuario*: antes empezaba en un menú y decidía; ahora empieza en su trabajo y ejecuta.

El **motor** de esto ya existe: cada entidad de Genus (OE, OA, lote, liberación, pedido) tiene **estado**. Eso es una máquina de estados completa. El ERP guiado por tareas no es una funcionalidad nueva inventada desde cero: es **una capa que lee esos estados y reparte el trabajo**.

Una tarea, conceptualmente, es:

> **(qué entidad · en qué estado · de quién es responsabilidad · cuál es la acción siguiente · con qué contexto · con qué urgencia).**

## 4. Qué significa "sistema asistente"

Un sistema asistente:

- **Sabe quién sos** y qué podés hacer.
- **Calcula tu trabajo pendiente** a partir del estado de las operaciones.
- **Te lo presenta priorizado**, lo más urgente primero.
- **Te muestra los problemas antes de que los busques.**
- **Te entrega el trabajo cuando es tu turno.**
- **Se vacía a medida que trabajás**, dándote un cierre ("terminaste por hoy").

Lo opuesto de un asistente es una base de datos: una base de datos te muestra todo y te obliga a decidir; un asistente decide el orden y te muestra lo siguiente.

## 5. Qué significa "que el trabajo llegue al usuario"

En Genus, el usuario no va a buscar el trabajo: el trabajo llega a su bandeja cuando es su turno. Dos mecanismos:

- **Lo asignado** aparece en su foco.
- **Los problemas** (un desvío, un faltante, un vencimiento, una incidencia) *suben solos* a su atención.

El usuario no filtra, no recorre listas, no monitorea: recibe.

## 6. Qué significa "una posta entre roles"

El trabajo de una operación atraviesa varios roles. Genus pasa esa **posta** automáticamente según el estado, respetando la segregación de funciones GMP:

1. El **Operario** elabora la OE y la marca lista. → sale de su bandeja.
2. Aparece la tarea *"cerrar OE"* en la bandeja del **Supervisor**. La cierra.
3. Al cerrarse, el granel entra en cuarentena → aparece *"analizar/disponer"* en la bandeja de **Calidad**.
4. Calidad deja la disposición en borrador → aparece *"firmar"* en la bandeja de **Dirección Técnica**.
5. DT firma → el lote queda **liberado** → aparece *"despachar"* en la bandeja de **Depósito**.
6. El despacho avanza el pedido → **Comercial** lo ve progresar hacia "entregado".

Nadie empuja el trabajo a mano. El sistema pasa la posta, y *quién recibe cada posta* lo define el RBAC (ver `04-rbac.md`).

## 7. Qué problema resuelve

- **Trazabilidad GMP fragmentada:** hoy el dato vive en planillas dispersas; un lote no es trazable de punta a punta sin trabajo manual. Genus lo unifica en un libro mayor append-only.
- **Error operativo:** la carga manual permite consumir un lote equivocado, en cuarentena, o cantidades incoherentes. Genus lo impide por validación.
- **Falta de segregación:** sin control de acceso, cualquiera podría cerrar y liberar. Genus separa funciones por diseño.
- **Sobrecarga cognitiva:** el operario hoy tiene que saber qué hacer y dónde registrarlo. Genus se lo dice.

## 8. Por qué el usuario nunca debería pensar en tablas

Las tablas son la representación del **dato**, no del **trabajo**. Para auditar o consultar, una tabla es perfecta. Para trabajar, es ruido: obliga a leer columnas, filtrar y decidir. El operario en planta no debe ver `MOVIMIENTOS` ni `OE_CONSUMO` como grillas; debe ver *"cargá el lote de Agua que usaste"*. Las tablas existen en Genus, pero como **consulta**, nunca como superficie de trabajo.

## 9. La experiencia que buscamos

Que cuando una persona abra Genus —operario, supervisor, calidad, dirección— el sistema **ya sepa, y le diga, qué es lo próximo que tiene que hacer**; que lo resuelva en un flujo guiado que no la deje equivocarse; y que al terminar reciba lo siguiente, hasta que su día se vacíe. Que se sienta un sistema hecho para ella, no una base de datos que tiene que operar.

Esa es la vara contra la que se mide cada decisión de producto y de ingeniería en este proyecto.
