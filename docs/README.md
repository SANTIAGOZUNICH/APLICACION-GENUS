# Genus Operaciones — Documentación técnica del proyecto

> Documentación de handoff definitiva. Autocontenida. Pensada para que un equipo de desarrollo (o un asistente de código como Cursor AI) pueda continuar el proyecto sin contexto previo.

---

## Qué es Genus Operaciones

**Genus Operaciones** es el sistema digital de operaciones de **Laboratorio Genus**, un fabricante cosmético por contrato (third-party manufacturer) radicado en Avellaneda, Provincia de Buenos Aires, Argentina. El laboratorio opera bajo regulación **ANMAT**, prácticas **GMP** (Good Manufacturing Practices) y norma **ISO 9001:2015**, con un plantel de alrededor de 40 personas y un catálogo amplio de productos terminados, materias primas y materiales de empaque, fabricando para aproximadamente 22 marcas cliente (entre ellas Jactans, TMCO/The Minimal Co y TYL).

El sistema cubre el ciclo operativo completo del laboratorio:

```
Pedido del cliente
    → Planificación
    → Orden de Elaboración (OE) — produce granel
    → Consumo de materias primas por lote
    → Liberación del granel (primera barrera GMP)
    → Orden de Acondicionamiento (OA) — produce producto terminado (PT)
    → Consumo de materiales de empaque por lote
    → Control de calidad y liberación del PT (segunda barrera GMP)
    → Despacho contra pedido
```

Con trazabilidad por lote de punta a punta y control de acceso por rol con segregación de funciones GMP.

Genus no es una planilla mejorada ni un simple sistema de stock: es la representación digital del proceso productivo completo, diseñado para evolucionar hacia un **ERP guiado por tareas** donde el sistema le dice a cada persona qué tiene que hacer ahora.

---

## Objetivo

Reemplazar planillas dispersas y procesos manuales por un sistema único, trazable y auditable que:

1. Garantice la **trazabilidad GMP** de cada lote (de materia prima a producto despachado).
2. Haga **imposible el error operativo** mediante flujos guiados y validaciones (error-proofing).
3. Imponga **segregación de funciones** (quien ejecuta no libera; quien produce no firma).
4. Elimine planillas paralelas: una sola fuente de verdad.
5. Reduzca la **carga cognitiva**: que el sistema diga qué hacer, no que el usuario navegue tablas.
6. Proporcione **visibilidad operativa** en tiempo cuasi-real para supervisión y dirección.

---

## Tecnologías que utiliza hoy (backend de producción)

| Componente | Función |
|---|---|
| **Google Sheets** | Base de datos. Cada tabla del modelo es una pestaña. Las fórmulas (signo de movimiento, saldos, cumplimiento de pedido) son parte de la lógica de negocio. |
| **AppSheet** | Capa de aplicación: vistas, formularios, acciones, RBAC (Security Filters / Editable_If / Only_If), automatizaciones (bots). |
| **Apps Script** | Automatización y lógica complementaria cuando AppSheet no alcanza. |
| **Looker Studio** | Reportería y tableros ejecutivos. |
| **Slack** | Canal de notificaciones (uso actual / previsto). |

Este stack **no se reemplaza**. Es el backend de verdad y se mantiene. Ver `16-backend.md`.

---

## Tecnologías que utilizará en el futuro (capa de experiencia)

| Componente | Función |
|---|---|
| **Front-end web/móvil propio** | React/Next.js o equivalente moderno. Consume los mismos datos vía API. Alcanza el 100% de la experiencia diseñada que AppSheet no puede dar. Ver `15-frontend.md`. |
| **Capa de API** | Servicio intermedio que traduce intenciones del front-end en operaciones válidas sobre el backend, revalidando RBAC y reglas GMP del lado servidor. Ver `17-api.md`. |
| **Tabla `TAREAS`** | Materializa la Bandeja Inteligente de Trabajo: cola unificada y priorizada por persona. Ver `09-bandeja-inteligente.md`. |
| **Asistente conversacional "Creamy"** | Asistente del Director Técnico con RAG sobre procedimientos. Ver `10-chatbot-creamy.md`. |
| **Módulos de Comunicación, Procedimientos y Capacitaciones** | Comunicación interna contextual, gestión documental GMP y formación del personal. Ver `11`, `12`, `13`. |

### Estado actual del proyecto

| Área | Estado |
|---|---|
| Backend operativo (F1–F4.1) | Construido y verificado |
| RBAC (F6.0) | Construido y verificado en sandbox; pendiente incorporación a producción |
| Línea de experiencia (F6.5–F7.5) | Diseñada y aprobada como blueprint; pendiente de construcción |
| Creamy, Comunicación, Procedimientos, Capacitaciones | Módulos futuros propuestos; no diseñados en detalle |

---

## Cómo leer esta documentación

La carpeta `/docs` contiene 21 documentos numerados más este README. Cada documento es autocontenido pero se complementan entre sí. No hay un único documento resumen: la información está distribuida por dominio para facilitar la consulta y el mantenimiento.

### Orden de lectura recomendado según tu objetivo

**Para entender el proyecto (cualquiera):**
1. `README.md` (este documento)
2. `00-vision-general.md` — filosofía y principios conceptuales
3. `01-producto.md` — objetivos, usuarios, casos de uso
4. `05-flujos-operativos.md` — el laboratorio de punta a punta

**Para desarrollar backend / modelo de datos:**
1. `02-arquitectura.md` — entidades, relaciones, movimiento de información
2. `03-modelo-de-datos.md` — diccionario de datos completo
3. `04-rbac.md` — roles, permisos, segregación GMP
4. `18-convenciones.md` — naming, estados, terminología

**Para desarrollar el front-end nuevo:**
1. `15-frontend.md` — visión ideal del front-end
2. `07-design-system.md` — tokens, componentes, reglas visuales
3. `08-workspaces.md` — espacios de trabajo por misión
4. `09-bandeja-inteligente.md` — la bandeja de "lo próximo"
5. `17-api.md` — arquitectura de API futura
6. `16-backend.md` — qué no cambiar del backend

**Para continuar con Cursor AI:**
1. **Empezar por `20-recomendaciones-cursor.md`**
2. Volver al resto según la tarea concreta

**Para planificar trabajo:**
1. `14-roadmap.md` — fases F1–F7, buckets, prioridades
2. `19-pendientes.md` — inventario completo de pendientes

---

## Índice de documentos

| Archivo | Contenido |
|---|---|
| `00-vision-general.md` | Filosofía: ERP guiado por tareas, sistema asistente, la posta |
| `01-producto.md` | Objetivos, usuarios, roles, casos de uso, beneficios, KPIs |
| `02-arquitectura.md` | Entidades, relaciones, cómo se mueve la información |
| `03-modelo-de-datos.md` | Diccionario de datos completo (todas las tablas) |
| `04-rbac.md` | Roles, permisos, segregación GMP |
| `05-flujos-operativos.md` | El laboratorio de punta a punta |
| `06-modulos.md` | Módulos funcionales |
| `07-design-system.md` | ADN visual: tokens, componentes, reglas |
| `08-workspaces.md` | Espacios de trabajo por misión |
| `09-bandeja-inteligente.md` | La bandeja de "lo próximo" y la tabla TAREAS |
| `10-chatbot-creamy.md` | Asistente del DT (módulo futuro propuesto) |
| `11-comunicacion.md` | Comunicación interna (módulo futuro propuesto) |
| `12-procedimientos.md` | POEs y gestión documental (módulo futuro propuesto) |
| `13-capacitaciones.md` | Capacitaciones (módulo futuro propuesto) |
| `14-roadmap.md` | Fases F1–F7, estado, buckets, prioridades |
| `15-frontend.md` | Visión del front-end propio (ideal, sin AppSheet) |
| `16-backend.md` | El backend existente no cambia |
| `17-api.md` | Arquitectura de API futura |
| `18-convenciones.md` | Lenguaje, naming, estados, terminología |
| `19-pendientes.md` | Todo lo pendiente |
| `20-recomendaciones-cursor.md` | Guía para Cursor AI (leer primero) |

---

## Glosario rápido

| Término | Significado |
|---|---|
| **OE** | Orden de Elaboración. Produce un **granel** (bulk). |
| **OA** | Orden de Acondicionamiento. Produce un **Producto Terminado (PT)** envasando un granel. |
| **Granel** | Producto a granel resultado de una OE. |
| **PT** | Producto Terminado. SKU envasado y etiquetado. |
| **MP** | Materia Prima. Insumo de fórmula. |
| **ME** | Material de Empaque. Frasco, tapa, etiqueta, estuche. |
| **Lote** | Unidad trazable de cualquier ítem (MP, ME, Granel, PT). |
| **BOM** | Bill of Materials. Fórmula/receta versionada. También referido como "fórmula". |
| **Liberación** | Disposición de calidad firmada por Dirección Técnica que habilita un lote para uso/despacho. |
| **DT** | Dirección Técnica. Responsable legal ANMAT de la liberación. |
| **RBAC** | Role-Based Access Control. Control de acceso por rol. |
| **GMP** | Good Manufacturing Practices. Buenas Prácticas de Manufactura. |
| **ANMAT** | Administración Nacional de Medicamentos, Alimentos y Tecnología Médica (regulador argentino). |
| **Posta** | Pase automático de trabajo de un rol al siguiente según el estado de la operación. |
| **Bandeja Inteligente** | Superficie de "lo próximo que tenés que hacer", personal y por rol. |
| **Workspace** | Espacio de trabajo organizado por misión (Producción, Calidad, Comercial, etc.). |
| **ALCOA** | Attributable, Legible, Contemporaneous, Original, Accurate. Principios de integridad de datos. |

---

## Convenciones de este repositorio

- La documentación vive en `/docs`.
- Los documentos numerados (`00`–`20`) siguen un orden lógico de lectura, no de dependencia estricta.
- Los módulos marcados como **MÓDULO FUTURO PROPUESTO** no están diseñados en detalle ni construidos; son dirección aprobada conceptualmente.
- Las tablas del modelo marcadas **[VERIFICADA]** existen en producción con la estructura documentada. Las **[DISEÑADA]** están especificadas pero pueden estar pendientes de construcción. Las **[PROPUESTA]** son recomendaciones para funcionalidad futura.
