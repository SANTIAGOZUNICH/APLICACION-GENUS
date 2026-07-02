# 23 — F9 Rediseño UX/UI: Genus OS como Sistema Operativo de Planta

> **Estado:** F9.2 — Envasado Masivo con WorkItems reales en `/design-preview`  
> **Alcance:** 100% UX/UI. Backend F8 **congelado**.  
> **Referencia funcional:** SEMANAS 2026 (lógica: línea · día · cliente · producto · cantidad)  
> **Referencia visual:** mock Envasado Masivo (sidebar navy, aire, turquesa)

---

## F9.1 — Refinamiento (producto, no CSS)

### Cambios respecto a F9.0

| Antes | F9.1 |
|-------|------|
| KPIs en Home operarios | **Eliminados** — solo trabajo |
| Tablas / filas ERP | **Orden de Trabajo** — bloques grandes |
| Mismo layout por sector | **App distinta** por sector |
| Texto explicativo | **Mínimo** — "Hoy", "En proceso" |
| Creamy genérica | **Compañera** — sidebar inferior |

### Regla de oro (interna)

> ¿Un operario que nunca usó el sistema entiende qué hacer en **menos de 5 segundos**?

Si no → rediseñar.

### Criterio de aprobación (usuario)

- Elaboración → qué elaborar
- Envasado → qué envasar, en qué línea
- Calidad → qué analizar
- Depósito → qué preparar
- Producción → qué problema resolver **ahora**
- Dirección → estado general, sin operación

---

## 1. Principio rector

**La Home no es un dashboard. La Home es una lista clara de trabajo.**

Pregunta única al entrar:

> ¿Qué tengo que hacer hoy?

Genus OS deja de parecer un ERP. Pasa a ser el **sistema operativo interno del laboratorio**.

---

## 2. Arquitectura visual

### 2.1 Capas de la interfaz

```text
┌─────────────────────────────────────────────────────────────┐
│  OS Shell (persistente)                                      │
│  ┌──────────┬──────────────────────────────────────────────┐│
│  │ Sidebar  │  Header (fecha · notificaciones · perfil)   ││
│  │          ├──────────────────────────────────────────────┤│
│  │ Logo     │                                              ││
│  │ Sector   │  Sector View (cambia por usuario/sector)     ││
│  │ Nav      │  — Mi Trabajo · Plan · Consulta · etc.     ││
│  │ Creamy   │                                              ││
│  │ Perfil   │                                              ││
│  │ Logout   │                                              ││
│  └──────────┴──────────────────────────────────────────────┘│
│  Status bar (fuente · sync · hora)                           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Shell vs Sector View

| Capa | Responsabilidad | Igual para todos |
|------|-----------------|------------------|
| **OS Shell** | Navegación, identidad, sector activo, Creamy AI | Estructura sí; contenido nav varía por rol |
| **Sector View** | Pantallas operativas | **No** — cada sector es una experiencia distinta |
| **Work Block** | Unidad atómica de trabajo | Patrón compartido; contenido y acciones varían |

### 2.3 Orden de Trabajo (patrón Envasado)

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LÍNEA 2
THELMA Y LOUISE
EXFOLIANTE ARROZ
3300 × 160 g
Entrega · HOY
Estado · 🟡 Pendiente
[ Abrir OA ]
☐ Trabajo terminado
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Campos en 5 segundos: **línea · cliente · producto · cantidad · entrega · estado · acción**.

### 2.4 Layouts distintos por sector (F9.1)

| Sector | Layout | Centro visual |
|--------|--------|---------------|
| Envasado M/P | Bloques apilados | Línea + presentación |
| Elaboración | Fila horizontal | **Kg** + OE |
| Calidad | Cards mesa | Lote + resultado |
| Depósito | Checklist vertical | Insumos a preparar |
| Producción | Problemas → barras | **Qué está mal** |
| Dirección | Señales tipográficas | Estado general |

### 2.5 Tipos de Sector View

| Tipo | Sectores | Patrón |
|------|----------|--------|
| **Lista de trabajo** | Elaboración, Envasado M/P, Codificado, MP | Bloques apilados por sección temporal |
| **Mesa de laboratorio** | Calidad | Filas compactas, acciones Aprobar/Rechazar |
| **Checklist de preparación** | Depósito | Pedido + insumos + inputs numéricos |
| **Centro de control** | Producción | Barras de carga + problemas + plan |
| **Panorama ejecutivo** | Dirección | KPIs, alertas — sin acciones operativas |
| **Calendario semanal** | Plan semanal | Columnas L–V, bloques por día |
| **Spotlight** | Consulta | Búsqueda global, resultados agrupados |

---

## 3. Navegación F9

### 3.1 Menú base (operarios)

- Mi trabajo
- Plan semanal
- Consulta
- Insumos
- Calidad
- Configuración

### 3.2 Solo roles autorizados

- Producción
- Dirección

### 3.3 Eliminado

- Concepto **Workspaces** (Bandeja, workspaces entity-centric)
- KPIs en header
- Menús por entidad (OE, Pedido, Lote como home)

---

## 4. Sidebar

Contenido **únicamente**:

1. Logo — GENUS OS · Sistema Operativo
2. Sector activo — nombre + estado (En línea)
3. Menú — ítems según rol
4. Creamy AI — card integrada (no flotante)
5. Perfil — avatar + email
6. Cerrar sesión

---

## 5. Header

Contenido **únicamente**:

1. Título mínimo ("Mi trabajo")
2. Notificaciones
3. Perfil

**Sin** subtítulos explicativos. **Sin** KPIs. **Sin** fecha fija hardcodeada.

> La navegación por día vive en la **Sector View** (ej. Envasado Masivo), no en el header global.

---

## 6. Experiencias por sector

### 6.1 Envasado Masivo / Premium

**Envasado Masivo (F9.1 refinado)** — puesto de trabajo digital, no wireframe:

| Zona | Contenido |
|------|-----------|
| Encabezado | Hola, Envasado Masivo · día seleccionado · última sync |
| Selector | ◀ ▶ · fecha larga · botón **Hoy** (default = hoy real) |
| Resumen | Para hacer · En progreso · Terminadas · Bloqueadas |
| Trabajo del día | **Una card por línea** (L1, L2, L3) con cliente, producto, cantidad, entrega |
| Plan semanal | L–V clickeable; día actual destacado; cambia vista principal |
| Panel lateral | Próximas entregas · Problemas/faltantes · Creamy AI contextual |

**Card por línea (ejemplo):**

```text
LÍNEA 1
THELMA Y LOUISE
Exfoliante Arroz
3.300 × 160 g
Entrega · Hoy
[ Abrir OA ]   ☐ Trabajo terminado   Reportar problema
```

**Línea sin trabajo:** texto claro — *"Sin trabajo asignado para hoy"* (no caja vacía).

**Acciones visuales (preview only — sin escritura Sheets):**

- Abrir OA (si existe)
- Crear OA (si no existe)
- Marcar terminado (checkbox)
- Reportar problema

**Premium:** layout similar; **nunca** ve Masivo.

#### Regla de fecha dinámica (SEMANAS 2026)

| Regla | Comportamiento |
|-------|----------------|
| Default | Fecha seleccionada = **hoy** (fecha real del sistema) |
| Selector | Anterior / Siguiente / **Hoy** cambian el día visible |
| Fuente futura | Bloque del día en **SEMANAS 2026** correspondiente al día seleccionado |
| Ejemplo | Si hoy es miércoles 2 de julio → mostrar trabajos del miércoles 2, no del 23 de junio |
| Preview mock | `buildMasivoWeekSchedule(today)` genera datos relativos a la semana laboral actual |
| Fallback | Si no hay bloque para el día → líneas vacías + *"Sin trabajo asignado para hoy"* |

**Prohibido en preview:**

- Fechas viejas hardcodeadas (ej. "23 de junio" fijo)
- Datos mock sin indicar que son mock
- Cajas vacías como contenido principal cuando hay trabajo
- Copiar visualmente la planilla SEMANAS

**Secciones legacy (otros sectores):** Para hacer hoy · Esta semana · Mis OA · Bloqueados  
**Acciones:** Crear OA · Abrir OA · Completar · Terminado · Observaciones  
**Regla:** Premium **nunca** ve Masivo.

### 6.2 Elaboración

**Campos por bloque:** Cliente · Producto · Cantidad · Kg · Responsable · OE · Estado  
**Acciones:** Abrir OE · Iniciada · Terminada · Observaciones

### 6.3 Calidad

Mesa de laboratorio: Lotes pendientes · Resultados · Liberaciones · Bloqueados  
**Fila:** Lote · Producto · Cliente · OE · OA · Resultado · ☐ Aprobar · ☐ Rechazar

### 6.4 Depósito

Checklist por pedido: Cliente · Producto · Cantidad · Envases · Tapas · Etiquetas · Cajas  
Inputs: preparados de cada insumo. **UI only** — sin escritura Sheets.

### 6.5 Producción

Centro de control — barras de carga por sector, lista de problemas, plan semanal debajo. **No listas operativas.**

### 6.6 Dirección

Producción · Pedidos · Entregas · KPIs · Alertas. **Nada operativo.**

---

## 7. Estética

| Referencia | Qué tomar |
|------------|-----------|
| Linear / Vercel | Aire, tipografía, bordes suaves |
| Stripe | Confianza, jerarquía clara |
| Notion | Bloques legibles |
| Apple / Arc | Premium, calma |

**Tokens F9 (preview):**

- Turquesa institucional `#1fa39a` — acento, progreso
- Navy sidebar `#0f172a` — identidad OS
- Fondo `#f8fafc` — mucho aire
- Tipografía grande en bloques de trabajo
- Cards livianas, sombras mínimas
- Nada estridente

---

## 8. Creamy AI — Copiloto contextual (F9.2)

Creamy deja de modelarse como chatbot genérico. Es un **copiloto** integrado al trabajo activo:

```text
Creamy · Copiloto
Prioridad: THELMA Y LOUISE
Te guío con la OA y los pasos para cerrar el día.
[ Abrir OA ] [ Ver insumos ] [ Marcar avance ]
```

| Antes (F9.1 mock) | F9.2 copiloto |
|-------------------|---------------|
| "¿Necesitás ayuda?" | Headline según estado real del día |
| Botón Abrir genérico | Sugerencias contextuales (chips) |
| Sin datos | Lee WorkItems del sector + día seleccionado |

Sin botón flotante. Personaje visual en fase posterior.

---

## 9. Login futuro (F10)

Un email → un sector → una Sector View completa.

| Email | Experiencia |
|-------|-------------|
| emasivo@… | Envasado Masivo |
| epremium@… | Envasado Premium |
| elaboracion@… | Elaboración |
| calidad@… | Calidad (mesa) |
| deposito@… | Depósito (checklist) |
| produccion@… | Centro de control |
| direccion@… | Panorama ejecutivo |

---

## 10. Wireframes / Preview operativo

Implementados en **`/design-preview`**.

| Pantalla | Fuente de datos (F9.2) |
|----------|------------------------|
| Hub + arquitectura | Estático |
| Mi Trabajo · Masivo | **WorkItems reales** · `GET /api/v1/work-items?sector=ENVASADO_MASIVO` |
| Mi Trabajo · Premium | Mock legacy → migrar a WorkItems |
| Elaboración | Mock legacy → migrar a WorkItems |
| Calidad | Mock legacy |
| Depósito | Mock legacy |
| Producción | Mock legacy |
| Dirección | Mock legacy |
| Plan semanal | Mock legacy → migrar a WorkItems |
| Consulta | Mock legacy |

---

## 11. Criterio de éxito

El operario abre Genus OS, mira **5 segundos** y sabe:

- qué hacer
- cuánto
- cuándo
- en qué línea
- si ya terminó

**Sin** abrir SEMANAS 2026, PEDIDOS 2026 ni ASIGNACION DE LOTES.

---

## 12. Próximo paso

1. Validar Envasado Masivo con **datos reales** en `/design-preview` (F9.2)
2. Migrar sectores restantes del preview a WorkItems (Premium, Elaboración, Plan semanal)
3. Usuario aprueba la experiencia operativa
4. Promover `/design-preview` → app principal (`/mi-trabajo`) sin cambiar mappers

**F9.2:** el preview ya consume el pipeline real. **No** inventar datos cuando Drive está configurado.

---

## 13. F9.2 — Datos reales en design-preview

### Pipeline

```text
SEMANAS 2026 → Discovery → Mapper → WorkItems → Design Preview
```

| Capa | Archivo / endpoint |
|------|-------------------|
| Mapper | `lib/mappers/semanas-to-work-items.ts` |
| Servicio | `lib/operational/work-items.service.ts` |
| API | `GET /api/v1/work-items?sector=ENVASADO_MASIVO` |
| Preview hook | `design-preview/hooks/use-sector-work-items.ts` |
| Vista día | `design-preview/lib/work-items-day-view.ts` |

### Reglas

| Regla | Comportamiento |
|-------|----------------|
| Fecha default | Hoy real — `startOfDay(new Date())` |
| Resolución por día | Filtra WorkItems por `date`, `dayLabel` o `deliveryDate` del mapper |
| Sin metadata de fecha | Si SEMANAS no trae día, muestra todos los items **solo para hoy** |
| Línea vacía | *"Sin trabajo asignado para hoy"* — no caja vacía |
| Sin datos inventados | Si `GENUS_DATA_MODE≠real` o Drive no configurado → lista vacía + mensaje |
| Acciones | Visuales only — sin escritura Sheets (igual que F9.1) |

### Eliminado en F9.2 (Envasado Masivo)

- `buildMasivoWeekSchedule()` — reemplazado por WorkItems
- `calendar-mock.ts` — reemplazado por `calendar.ts` (solo utilidades de fecha)
- `mock-data/envasado-masivo-schedule.ts` — eliminado

### Pendiente migración mock → real

- `mock-data.ts` — aún usado por Premium, Elaboración, Calidad, etc.
- `PLAN_SEMANAL_DAYS` — hardcodeado en plan-semanal wireframe

---

## 14. F9.1 — Envasado Masivo: criterios de aceptación

- [x] Estética moderna (Linear / Apple / Vercel) — aire, cards suaves, turquesa Genus
- [x] Fecha **no** hardcodeada; selector ◀ ▶ Hoy con default = hoy
- [x] Día actual destacado en plan semanal L–V
- [x] Trabajos por línea con cliente · producto · cantidad · entrega
- [x] Línea vacía → mensaje claro
- [x] Resumen: Para hacer / En progreso / Terminadas / Bloqueadas
- [x] Panel lateral: entregas · problemas · Creamy contextual
- [x] Acciones visuales por trabajo (sin escritura Sheets)
- [x] Operario entiende qué hacer en **5 segundos**

---

## 15. F9.2 — Criterios de aceptación

- [x] Envasado Masivo consume WorkItems vía API real
- [x] Sin `buildMasivoWeekSchedule()` ni schedule mock
- [x] Fecha resuelta automáticamente según día actual
- [x] Creamy modelada como copiloto contextual
- [ ] Premium / Elaboración / Plan semanal migrados a WorkItems
- [x] Mensaje claro cuando no hay Drive o SEMANAS no indexado
