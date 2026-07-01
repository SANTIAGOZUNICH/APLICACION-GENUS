# Genus Operaciones — Documentación técnica del proyecto

> Documentación de handoff. Autocontenida. Pensada para que un equipo de desarrollo (o un asistente de código como Cursor AI) pueda continuar el proyecto sin contexto previo.

---

## Qué es Genus Operaciones

**Genus Operaciones** es el sistema digital de operaciones de **Laboratorio Genus**, un fabricante cosmético por contrato (third-party manufacturer) radicado en Avellaneda, Provincia de Buenos Aires, Argentina. El laboratorio opera bajo regulación **ANMAT**, prácticas **GMP** (Good Manufacturing Practices) y norma **ISO 9001:2015**, con un plantel de alrededor de 40 personas y un catálogo amplio de productos terminados, materias primas y materiales de empaque, fabricando para ~22 marcas cliente (entre ellas Jactans, TMCO/The Minimal Co y TYL).

El sistema cubre el ciclo operativo completo del laboratorio: pedido del cliente → planificación → orden de elaboración (granel) → orden de acondicionamiento (producto terminado) → control de calidad → liberación → despacho, con trazabilidad por lote de punta a punta y control de acceso por rol con segregación de funciones GMP.

## Objetivo

Reemplazar planillas dispersas y procesos manuales por un sistema único, trazable y auditable que:

1. Garantice la **trazabilidad GMP** de cada lote (de materia prima a producto despachado).
2. Haga **imposible el error operativo** mediante flujos guiados y validaciones.
3. Imponga **segregación de funciones** (quien ejecuta no libera; quien produce no firma).
4. Evolucione hacia un **ERP guiado por tareas**: que el sistema le diga a cada persona *qué tiene que hacer ahora*, en lugar de obligarla a navegar.

## Tecnologías que utiliza hoy (backend de producción)

- **Google Sheets** — base de datos (cada tabla es una pestaña).
- **AppSheet** — capa de aplicación (vistas, formularios, acciones, RBAC, automatizaciones).
- **Apps Script** — automatización y lógica complementaria.
- **Looker Studio** — reportería.
- **Slack** — notificaciones (uso actual / previsto).

Este stack **no se reemplaza**. Es el backend de verdad y se mantiene (ver `16-backend.md`).

## Tecnologías que utilizará en el futuro (capa de experiencia)

- Un **front-end web/móvil propio** (visión: React/Next.js o equivalente moderno) que consuma los mismos datos a través de una **API** (ver `15-frontend.md` y `17-api.md`), para alcanzar el 100% de la experiencia diseñada que AppSheet no puede dar.
- Una **tabla `TAREAS`** y automatizaciones que materialicen la "Bandeja Inteligente de Trabajo" (ver `09-bandeja-inteligente.md`).
- Un **asistente conversacional ("Creamy")** para el Director Técnico (ver `10-chatbot-creamy.md`).
- Módulos de **Comunicación interna**, **Procedimientos (POEs)** y **Capacitaciones** (ver `11`, `12`, `13`).

> **Nota de estado.** El backend operativo (F1–F4.1) y el RBAC (F6.0) están **construidos y verificados**. Toda la línea de experiencia (F6.5–F7.5) está **diseñada y aprobada como blueprint**, pendiente de construcción. Las secciones de Creamy, Comunicación, Procedimientos y Capacitaciones son **módulos futuros propuestos** (no diseñados en detalle aún): están claramente marcados como tales.

---

## Cómo leer esta documentación

La carpeta `/docs` contiene 22 documentos numerados. Cada uno es autocontenido pero se complementan.

**Orden de lectura recomendado según tu objetivo:**

- **Para entender el proyecto (cualquiera):** `README.md` → `00-vision-general.md` → `01-producto.md` → `05-flujos-operativos.md`.
- **Para desarrollar backend / modelo:** `02-arquitectura.md` → `03-modelo-de-datos.md` → `04-rbac.md` → `18-convenciones.md`.
- **Para desarrollar el front-end nuevo:** `15-frontend.md` → `07-design-system.md` → `08-workspaces.md` → `09-bandeja-inteligente.md` → `17-api.md` → `16-backend.md`.
- **Para continuar con un asistente de código (Cursor AI):** **empezá por `20-recomendaciones-cursor.md`** y volvé al resto desde ahí.
- **Para planificar:** `14-roadmap.md` → `19-pendientes.md`.

**Índice:**

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
| `20-recomendaciones-cursor.md` | Guía para el asistente de código (leer primero) |

---

## Glosario rápido

- **OE** — Orden de Elaboración (produce un **granel**).
- **OA** — Orden de Acondicionamiento (produce un **Producto Terminado / PT** envasando un granel).
- **Granel** — producto a granel (bulk) resultado de una OE.
- **PT** — Producto Terminado (SKU envasado y etiquetado).
- **MP / ME** — Materia Prima / Material de Empaque.
- **Lote** — unidad trazable de cualquier ítem (MP, ME, Granel, PT).
- **BOM** — Bill of Materials (fórmula/receta versionada).
- **Liberación** — disposición de calidad que habilita un lote para su uso/despacho (firma del Director Técnico).
- **DT** — Dirección Técnica (responsable legal ANMAT de la liberación).
- **RBAC** — Role-Based Access Control (control de acceso por rol).
- **GMP** — Good Manufacturing Practices.
- **Posta** — el pase automático de trabajo de un rol al siguiente según el estado.
- **Bandeja Inteligente** — superficie de "lo próximo que tenés que hacer", personal y por rol.
