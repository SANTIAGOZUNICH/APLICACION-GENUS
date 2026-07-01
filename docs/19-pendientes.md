# 19 — Pendientes

Inventario completo de lo pendiente. Cada ítem: **qué es · estado · dependencia · prioridad** (P0 = primero; ver buckets en `14`).

---

## 1. Prerrequisito crítico (bloquea el RBAC en producción)

- **Incorporar las tablas de gobierno al Sheet de producción.** `ROLES`, `MODULOS`, `PERMISOS` (107 filas) y la columna `ROL_ID` en `USUARIOS` fueron construidas y verificadas en una base sandbox, pero **deben sumarse de forma aditiva al Google Sheet real** antes de configurar el RBAC en la app. Sin esto, el control de acceso no opera en producción. **P0.**

## 2. Capa de experiencia (F7) — construcción

- **Fase 1 — La cara nueva** (Design System aplicado, navegación/lenguaje, ocultar tablas, tema, acciones contextuales). Bucket A. **P0.**
- **Fase 2 — Operario guiado + Centro de Operaciones por rol** (formularios guiados, escaneo, alertas, KPIs de conteo). Bucket A/B. **P1.**
- **KPIs computados** (avance %, días en cuarentena, % aprobado, cumplimiento). Requiere VCR. Bucket B. **P1.**
- **Notificaciones simples** (primera posta: avisar al supervisor/calidad ante cambios de estado). Bucket B. **P1.**
- **Stock crítico / por vencer** (umbral por ítem). Bucket B. **P2.**

## 3. La inteligencia profunda

- **Tabla `TAREAS`** — la bandeja unificada de "lo próximo". Esquema y semántica a definir (`09`). Bucket C/D. **P1 (apuesta grande), pero después de los quick wins.**
- **Automatizaciones de la posta** — al cambiar un estado, crear/reasignar/cerrar la tarea del responsable siguiente. Depende de `TAREAS`. Bucket C. **P1/P2.**
- **Notificaciones push event-driven** (completas). Depende de automatizaciones. Bucket C. **P2.**
- **Feed de actividad reciente** (log por objeto, "chatter"). Tabla de log + automatización. Bucket C. **P3.**
- **Bandeja Inteligente real** (unificada y priorizada). Depende de `TAREAS` + automatizaciones. **P1/P2.**

## 4. Tabla INCIDENCIAS

- **"Reportar problema"** del operario → puerta a No Conformidad / CAPA. Tabla nueva + notificación. Bucket C. **P2.**

## 5. Módulos futuros propuestos (no diseñados en detalle)

- **Chatbot Creamy** (`10`) — asistente del DT. Requiere base de conocimiento (Procedimientos), RAG, guardrails de derivación. **P2/P3.** Prerrequisito: Procedimientos.
- **Comunicación** (`11`) — notificaciones/alertas/chat contextual; Teams/Slack. Definir modelo de mensajes y política de notificaciones. **P2/P3.**
- **Procedimientos / POEs** (`12`) — gestión documental con versionado/firmas. Prerrequisito de Creamy. **P2.**
- **Capacitaciones** (`13`) — cursos, learning journey, vencimientos, evaluaciones; integra con Procedimientos. **P3.**

## 6. KPIs / reportería que requieren datos nuevos

- **Nivel de servicio (a tiempo):** requiere `fecha_compromiso` en `PEDIDOS` (confirmar si ya existe) y fecha de entrega. **P2.**
- **Lead time por etapa:** requiere **timestamps por transición de estado** (tabla de eventos/log). **P3.**
- **Valor de inventario:** requiere **maestro de precios/costos** por ítem. **P3.**
- **Gráficos / timeline / dashboards ejecutivos** ricos: dependen de los anteriores. **P3.**

## 7. Front-end propio y API

- **Front-end moderno** (`15`) — visión ideal; bucket E; proyecto aparte. **P3 (futuro).**
- **Capa de API** (`17`) — prerrequisito del front-end propio. **P3 (futuro).**

## 8. Confirmaciones de datos pendientes

- Confirmar si `PEDIDOS` ya tiene **`fecha_compromiso`** (necesaria para nivel de servicio y para "compromiso por vencer" en Comercial).
- Confirmar si la fuente real es **Google Sheet** o un **Excel en Drive**, y el formato de importación de las tablas de gobierno (CSV / pegado / etc.).
- Confirmar si **Dirección** y **Dirección Técnica** son la misma persona (define si sus Workspaces se fusionan; ver `08`).
- Extender el `VLOOKUP` de `SALDOS.descripcion` a `PRODUCTOS` para que los **PT** muestren descripción (cosmético, opcional).

## 9. Calidad / técnico

- Pruebas de regresión de fórmulas (`recalc`) tras cada cambio en `MOVIMIENTOS`/`SALDOS`.
- Verificación de que toda incorporación al modelo sea **aditiva** (no rompe columnas/fórmulas existentes).
