# 00 — Visión general

Documento conceptual. Define **qué es Genus y por qué existe** antes de cualquier detalle técnico. Todo lo demás (modelo de datos, módulos, front-end, API) debe ser coherente con esta filosofía. Si una decisión de ingeniería contradice este documento, la decisión está mal.

---

## 1. Qué es Genus

Genus Operaciones es el sistema nervioso de un laboratorio cosmético GMP. No es "una app de stock" ni "una planilla mejorada": es la representación digital del **proceso productivo completo**, desde que un cliente hace un pedido hasta que el producto terminado, liberado por calidad, sale despachado, con cada lote trazable hacia atrás hasta sus materias primas.

### Contexto del laboratorio

Laboratorio Genus es un fabricante cosmético por contrato ubicado en Avellaneda, Provincia de Buenos Aires, Argentina. Opera bajo:

- Regulación **ANMAT** (Administración Nacional de Medicamentos, Alimentos y Tecnología Médica).
- Prácticas **GMP** (Good Manufacturing Practices).
- Norma **ISO 9001:2015**.

El plantel tiene aproximadamente 40 personas. Fabrica para unas 22 marcas cliente (Jactans, TMCO/The Minimal Co, TYL, entre otras). El catálogo incluye productos terminados cosméticos, materias primas y materiales de empaque.

### Las dos capas conceptuales

Genus tiene dos capas que deben entenderse por separado:

1. **El motor operativo (backend):** el registro fiel, append-only y auditable de todo lo que ocurre — recepciones, consumos, producciones, controles, liberaciones, despachos. Es la fuente de verdad GMP. Vive en Google Sheets + AppSheet.

2. **La experiencia (frontend):** la forma en que cada persona del laboratorio interactúa con ese motor. La visión es que esta capa sea un **asistente**, no una base de datos navegable. Hoy está parcialmente implementada en AppSheet; la visión completa requiere un front-end propio.

Estas capas son independientes en arquitectura pero inseparables en producto: el backend sin experiencia es una planilla; la experiencia sin backend es una interfaz vacía.

---

## 2. La filosofía del sistema

La filosofía se resume en una frase que el sistema le dice a cada usuario:

> **"Esto es lo próximo que tenés que hacer."**

El usuario no debe preguntarse nunca *"¿a qué módulo entro?"* ni *"¿en qué tabla está esto?"*. El sistema conoce el estado de todas las operaciones y quién es responsable de cada cosa; por lo tanto, **puede y debe** decirle a cada persona qué sigue.

### Principios rectores

| Principio | Significado |
|---|---|
| **Claridad sobre densidad** | Mostrar lo necesario, no todo lo posible. Menos columnas, más contexto. |
| **Consistencia absoluta** | Un mismo componente significa lo mismo en todas partes. Un color = un significado. |
| **Reconocer, no recordar** | El estado se ve (color + ícono), no se memoriza. El usuario no debe aprender códigos. |
| **Una acción primaria por contexto** | Cada pantalla/card tiene una sola acción evidente. El resto es secundario u oculto. |
| **El estado guía** | El color comunica significado, jamás decora. Verde = aprobado; rojo = problema. |
| **A prueba de error** | La validación frena el error antes de que ocurra; la confirmación protege lo irreversible. |
| **Pensado para planta** | Alto contraste, objetos grandes, lenguaje simple. El operario puede tener guantes. |

### La sensación objetivo

**Profesional, calmo, claro, confiable.** Estética "industrial limpia", apropiada para GMP. No llamativo; predecible. El usuario debe sentir que el sistema está de su lado, no que lucha contra él.

---

## 3. Qué significa "ERP guiado por tareas"

### El problema del ERP tradicional

Un ERP tradicional se organiza por **módulos** (tipos de dato): Inventario, Producción, Ventas, Calidad. El usuario tiene que saber en qué módulo está lo que necesita y navegar hasta ahí. El sistema es pasivo: espera que el usuario vaya a buscar el trabajo (*pull*).

Ejemplo del modelo tradicional:
- El supervisor quiere cerrar una OE → debe saber que las OE están en "Producción" → entrar al módulo → filtrar por estado "lista para cerrar" → encontrar la suya → ejecutar la acción.

### El modelo guiado por tareas

Un **ERP guiado por tareas** se organiza por **trabajo** (estado de las operaciones). El usuario abre la app y recibe directamente su lista de tareas pendientes, priorizada. El sistema es activo: reparte el trabajo (*push*).

Ejemplo del modelo guiado:
- El supervisor abre Genus → ve en su bandeja: *"Cerrar OE-0042 — Crema Hidratante Granel — lista para cierre"* → toca la card → confirma → listo.

La diferencia es de **dónde empieza el usuario**: antes empezaba en un menú y decidía; ahora empieza en su trabajo y ejecuta.

### El motor ya existe

El **motor** de esto ya existe en Genus: cada entidad (OE, OA, lote, liberación, pedido) tiene **estado**. Eso es una máquina de estados completa. El ERP guiado por tareas no es una funcionalidad nueva inventada desde cero: es **una capa que lee esos estados y reparte el trabajo**.

Una tarea, conceptualmente, es:

```
(qué entidad · en qué estado · de quién es responsabilidad · cuál es la acción siguiente · con qué contexto · con qué urgencia)
```

La tabla `TAREAS` (pendiente de construcción) materializará esto. Mientras tanto, los Workspaces con secciones por estado son una aproximación.

---

## 4. Qué significa "sistema asistente"

Un sistema asistente:

| Comportamiento | Descripción |
|---|---|
| **Sabe quién sos** | Conoce tu rol, tu área, tus permisos. |
| **Calcula tu trabajo pendiente** | A partir del estado de las operaciones y el RBAC. |
| **Te lo presenta priorizado** | Lo más urgente primero, siempre. |
| **Te muestra los problemas antes de que los busques** | Desvíos, faltantes, vencimientos suben solos. |
| **Te entrega el trabajo cuando es tu turno** | La posta entre roles es automática. |
| **Se vacía a medida que trabajás** | Cierre del día con sensación de progreso. |

Lo opuesto de un asistente es una base de datos: una base de datos te muestra todo y te obliga a decidir; un asistente decide el orden y te muestra lo siguiente.

### Analogías de referencia

- **Linear:** "My Issues" — tu trabajo, priorizado, sin ruido.
- **Monday:** tableros por estado — el trabajo fluye de columna en columna.
- **SAP Fiori:** worklist + object page — lista de trabajo + detalle de la entidad.

Genus toma lo mejor de estas referencias adaptado al contexto GMP de un laboratorio cosmético.

---

## 5. Qué significa "que el trabajo llegue al usuario"

En Genus, el usuario no va a buscar el trabajo: el trabajo llega a su bandeja cuando es su turno.

### Dos mecanismos

1. **Lo asignado** aparece en su foco según el plan y su rol.
2. **Los problemas** (un desvío, un faltante, un vencimiento, una incidencia) *suben solos* a su atención sin que tenga que monitorear.

El usuario no filtra, no recorre listas, no monitorea dashboards esperando que algo pase: **recibe**.

### Implicancia de diseño

Esto significa que:
- Las notificaciones no son opcionales; son parte del producto.
- La Bandeja Inteligente no es un "nice to have"; es la pantalla central.
- Los dashboards de métricas son secundarios; el trabajo accionable es primario.

---

## 6. Qué significa "una posta entre roles"

El trabajo de una operación atraviesa varios roles. Genus pasa esa **posta** automáticamente según el estado, respetando la segregación de funciones GMP.

### Ejemplo completo de la posta

```
1. El Operario elabora la OE y la marca lista.
   → La tarea sale de su bandeja.

2. Aparece "Cerrar OE" en la bandeja del Supervisor.
   → El Supervisor la cierra.

3. Al cerrarse, el granel entra en cuarentena.
   → Aparece "Analizar/disponer" en la bandeja de Calidad.

4. Calidad deja la disposición en borrador.
   → Aparece "Firmar liberación" en la bandeja de Dirección Técnica.

5. DT firma → el lote queda LIBERADO.
   → Aparece "Crear/iniciar OA" en Producción.
   → El Operario de acondicionamiento ejecuta la OA.

6. OA cerrada → PT en cuarentena.
   → Calidad analiza → DT firma → PT LIBERADO.

7. PT liberado.
   → Aparece "Despachar" en la bandeja de Depósito.

8. Despacho registrado.
   → Comercial ve el pedido progresar hacia "entregado".
```

Nadie empuja el trabajo a mano. El sistema pasa la posta, y *quién recibe cada posta* lo define el RBAC (ver `04-rbac.md`).

### Matriz de transiciones

| Evento (estado) | Tarea que aparece | Rol responsable |
|---|---|---|
| OE marcada lista | Cerrar OE | Supervisor |
| OE cerrada → granel en cuarentena | Analizar/disponer | Calidad |
| Disposición en borrador | Firmar liberación | Dirección Técnica |
| Granel liberado | Crear/iniciar OA | Supervisor / Operario acond. |
| OA cerrada → PT en cuarentena | Analizar/disponer | Calidad |
| PT liberado | Despachar contra pedido | Depósito |
| Despacho registrado | Seguimiento de pedido | Comercial |
| Faltante / desvío / vencimiento | Resolver problema | Supervisor / Calidad |

---

## 7. Qué problema resuelve

### Trazabilidad GMP fragmentada

**Antes:** el dato vivía en planillas dispersas (Excel, papel, múltiples archivos). Un lote no era trazable de punta a punta sin trabajo manual de cruce.

**Con Genus:** un libro mayor append-only (`MOVIMIENTOS`) unifica todo. La cadena PT → OA → Granel → OE → MP es reconstruible para cualquier lote en segundos.

### Error operativo

**Antes:** la carga manual permitía consumir un lote equivocado, en cuarentena, vencido, o en cantidades incoherentes con la fórmula.

**Con Genus:** validaciones error-proofing impiden guardar fuera de las reglas. El lote debe existir, ser del ítem correcto, estar liberado, no vencido, y la cantidad debe ser ≤ saldo.

### Falta de segregación de funciones

**Antes:** sin control de acceso, cualquiera podía cerrar una orden y liberar un lote. La segregación dependía de la disciplina de las personas.

**Con Genus:** RBAC default-deny con matriz `PERMISOS`. Quien ejecuta no firma; quien produce no se autoaprueba. La segregación es del sistema, no de la voluntad.

### Hueco crítico histórico: lote de ME no registrado

**Antes:** en el acondicionamiento, el material de empaque se consumía sin registrar el lote específico. Esto violaba GMP: no había trazabilidad de ME por PT.

**Con Genus:** `OA_MATERIALES` registra cada ME con su `LOTE_ID`. Resuelto por diseño.

### Sobrecarga cognitiva

**Antes:** el operario tenía que saber qué hacer y dónde registrarlo. Navegaba módulos, interpretaba estados, decidía prioridades.

**Con Genus:** el sistema se lo dice. Una tarea, una acción, un flujo guiado.

---

## 8. Por qué el usuario nunca debería pensar en tablas

Las tablas son la representación del **dato**, no del **trabajo**.

| Para qué sirven las tablas | Para qué NO sirven |
|---|---|
| Auditar | Trabajar |
| Consultar histórico | Decidir qué hacer |
| Exportar para inspección | Registrar consumos en planta |
| Verificar integridad | Operar el día a día |

Para auditar o consultar, una tabla es perfecta. Para trabajar, es ruido: obliga a leer columnas, filtrar y decidir. El operario en planta no debe ver `MOVIMIENTOS` ni `OE_CONSUMO` como grillas; debe ver *"Cargá el lote de Agua que usaste"*.

Las tablas existen en Genus, pero como **consulta** (para supervisores, calidad, dirección, auditorías), nunca como superficie de trabajo del operario.

### Regla de oro

Si tu solución obliga al operario a leer una grilla para hacer su trabajo, está mal diseñada.

---

## 9. La experiencia que buscamos

Que cuando una persona abra Genus —operario, supervisor, calidad, dirección— el sistema **ya sepa, y le diga, qué es lo próximo que tiene que hacer**; que lo resuelva en un flujo guiado que no la deje equivocarse; y que al terminar reciba lo siguiente, hasta que su día se vacíe.

Que se sienta un sistema hecho para ella, no una base de datos que tiene que operar.

### La vara de decisión

Ante cualquier decisión de producto o ingeniería, preguntarse:

1. ¿Esto hace que el usuario sepa qué hacer sin pensar?
2. ¿Esto respeta la trazabilidad GMP?
3. ¿Esto mantiene la segregación de funciones?
4. ¿Esto es coherente con el Design System?

Si la respuesta a cualquiera es "no", la decisión debe reconsiderarse.

Esa es la vara contra la que se mide cada decisión en este proyecto.

---

## 10. Relación con otros documentos

| Documento | Qué profundiza |
|---|---|
| `01-producto.md` | Objetivos, usuarios, KPIs |
| `02-arquitectura.md` | Cómo se implementa técnicamente esta filosofía |
| `05-flujos-operativos.md` | El recorrido completo del laboratorio |
| `07-design-system.md` | Cómo se ve y se siente |
| `08-workspaces.md` | Cómo se organiza el trabajo por misión |
| `09-bandeja-inteligente.md` | La materialización del "lo próximo" |
| `15-frontend.md` | La visión ideal de la interfaz |
| `20-recomendaciones-cursor.md` | Cómo continuar sin romper esta filosofía |
