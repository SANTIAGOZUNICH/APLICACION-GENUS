# 14 — Roadmap

Estado real del proyecto por fases, y el plan de construcción de la experiencia (F7).

> **Leyenda de estado:** ✅ Construido/verificado · 🟢 Diseñado y aprobado (blueprint, pendiente de construir) · 🟡 Propuesto (no diseñado en detalle).

---

## 1. Fases funcionales (F1–F6)

| Fase | Alcance | Estado |
|---|---|---|
| **F1 — Inventario** | `LOTES`, `MOVIMIENTOS` (append-only), `SALDOS` (derivado), maestros MP/ME | ✅ |
| **F2.0 — Pedidos/Planificación** | `PEDIDOS`, `PEDIDOS_DET`, `PLANIFICACION` | 🟢 |
| **F2.1 — BOM** | Fórmulas/recetas versionadas, densidad | 🟢 |
| **F2.2 — OE** | Orden de elaboración, consumo de MP por lote, producción de granel | 🟢 |
| **F3.0 — OA** | Orden de acondicionamiento, consumo de ME **por lote**, producción de PT | 🟢 |
| **F3.1 — Nacimiento de lote PT** | Lote PT en cuarentena al cerrar OA | 🟢 |
| **F4.0 — Calidad / Liberación** | `ANALISIS_CALIDAD`, `LIBERACIONES` (append-only), firma DT, dos barreras | 🟢 |
| **F4.1 — Despacho directo** | Despacho contra renglón de pedido; cumplimiento derivado; columnas `PEDIDO_ID`/`PEDIDO_DET_ID` en `MOVIMIENTOS` | 🟢 |
| **F6.0 — RBAC** | `ROLES`, `MODULOS`, `PERMISOS` (107 filas, default-deny), `ROL_ID` en `USUARIOS` | ✅ |

**Pendiente crítico de F6:** las tablas de gobierno (`ROLES`, `MODULOS`, `PERMISOS`) y la columna `ROL_ID` fueron construidas y verificadas en una base sandbox, pero **deben incorporarse al Google Sheet de producción** (de forma aditiva) antes de configurar el RBAC en la app. Ver `19-pendientes.md`.

## 2. Fase de experiencia (F7) — blueprints

| Sub-fase | Alcance | Estado |
|---|---|---|
| **F6.5 / F6.6** | UX operacional y error-proofing del operario | 🟢 |
| **F7.1** | Design System (tokens, componentes) — ver `07` | 🟢 |
| **F7.2** | Centro de Operaciones (dashboards) | 🟢 |
| **F7.3** | ERP guiado por tareas + Design System consolidado — ver `00`, `07` | 🟢 |
| **F7.4** | Visión completa de la experiencia (Bandeja Inteligente, la posta) — ver `09` | 🟢 |
| **F7.5** | Roadmap de construcción por buckets (este documento) | 🟢 |

## 3. Clasificación por buckets (qué construir y en qué orden)

**A** = hoy (solo UX/vistas/slices/format/navegación) · **B** = cambios chicos (columna, VCR, slice, acción, bot simple) · **C** = pequeña arquitectura (tabla, automatizaciones, logs) · **D** = grandes cambios/refactor/entidades nuevas · **E** = fuera de la plataforma actual (front-end propio).

| Funcionalidad | Bucket | Prioridad |
|---|---|---|
| Design System aplicado (badges, color, format rules) | A | P0 |
| Navegación colapsada + lenguaje ERP, ocultar tablas técnicas, tema de marca | A | P0 |
| Acciones contextuales (solo la acción válida) | A | P0 |
| Centro de Operaciones / dashboards de conteo | A | P1 |
| Empty states positivos | A | P2 |
| Formularios guiados del operario (Valid_If + revelado + confirmación) | B | P0/P1 |
| Escaneo de lote | B | P1 |
| KPIs computados (avance %, días, cumplimiento) | B | P1 |
| Notificaciones simples (primera "posta") | B | P1 |
| Stock crítico / por vencer (umbral) | B | P2 |
| Tabla `INCIDENCIAS` ("Reportar problema") | C | P2 |
| **Tabla `TAREAS`** (bandeja unificada) | C | **P1 — apuesta grande** |
| Automatizaciones de la posta | C | P1/P2 |
| Notificaciones push event-driven | C | P2 |
| Feed de actividad reciente (log) | C | P3 |
| ERP guiado por tareas integral (Workspaces + TAREAS + posta) | D | P2 |
| KPIs ejecutivos con nuevas entidades (lead time, valor de inventario) | D | P3 |
| Experiencia "Linear/Fiori" plena / front-end propio premium | E | P3 (futuro) |

## 4. Plan de fases de construcción (ejecutable)

- **FASE 1 — La cara nueva (2–3 días, bucket A):** Design System aplicado, navegación/lenguaje, ocultar tablas técnicas, tema, acciones contextuales. *Cero riesgo, sin tocar el modelo.*
- **FASE 2 — Que funcione para cada uno (1 semana, A+B):** Centro de Operaciones por rol (secciones por estado), experiencia del operario (formulario guiado + escaneo + alertas), KPIs de conteo.
- **FASE 3 — Que empiece a guiar (2 semanas, B + arranque C):** KPIs computados, notificaciones simples, `INCIDENCIAS`.
- **FASE 4 — El asistente real (3–4+ semanas, C/D):** `TAREAS`, automatizaciones de la posta, Bandeja Inteligente unificada, notificaciones push.
- **FASE 5 — El último 20% (futuro, E):** front-end propio para paridad total con la visión (ver `15`/`17`).

## 5. Quick wins (lo primero, máximo impacto / mínimo esfuerzo)

Aplicar el Design System (color semántico + badges), colapsar la navegación a lenguaje ERP, ocultar las tablas técnicas por rol, y dejar visible solo la acción válida en cada estado. En días, el sistema deja de verse como una planilla, **sin tocar datos ni seguridad**.

## 6. Estrategia de producto (primeros 30 días)

Priorizar lo **visible y diario** sobre la plomería invisible. Orden: (1) la cara nueva, (2) el operario guiado —quien más usa y más sufre la app—, (3) que cada rol vea "lo suyo", (4) la primera notificación que hace que el trabajo "llegue". `TAREAS` y las automatizaciones (la inteligencia profunda) vienen después, ya con los usuarios ganados. El éxito a 30 días se mide en que operario, supervisor y calidad digan que "se siente otra cosa", no en cuántas tablas nuevas hay.
