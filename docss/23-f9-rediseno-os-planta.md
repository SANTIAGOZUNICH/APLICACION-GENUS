# 23 — F9 Rediseño UX/UI: Genus OS como Sistema Operativo de Planta

> **Estado:** F9.1 refinamiento en `/design-preview` — **pendiente de aprobación**  
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

## 8. Creamy AI

Integrada en **sidebar inferior** (no flotante):

```text
Creamy AI
¿Necesitás ayuda con este trabajo?
[ Abrir ]
```

Sin botón flotante. Personaje en fase posterior.

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

## 10. Wireframes

Implementados en **`/design-preview`** (aislado de la app real).

| Pantalla | Archivo preview |
|----------|-----------------|
| Hub + arquitectura | `/design-preview` |
| Mi Trabajo · Masivo | wireframe `envasado-masivo` + mock `envasado-masivo-schedule` |
| Mi Trabajo · Premium | wireframe `envasado-premium` |
| Elaboración | wireframe `elaboracion` |
| Calidad | wireframe `calidad` |
| Depósito | wireframe `deposito` |
| Producción | wireframe `produccion` |
| Dirección | wireframe `direccion` |
| Plan semanal | wireframe `plan-semanal` |
| Consulta | wireframe `consulta` |

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

1. Usuario aprueba wireframes en `/design-preview`
2. **Recién entonces** implementar shell + vistas en la app real
3. Conectar WorkItems existentes (F8) a los nuevos bloques — sin tocar mappers

**Hasta aprobación: cero cambios en `/mi-trabajo`, sidebar, navigation.ts de producción.**

---

## 13. F9.1 — Envasado Masivo: criterios de aceptación

- [ ] Estética moderna (Linear / Apple / Vercel) — aire, cards suaves, turquesa Genus
- [ ] Fecha **no** hardcodeada; selector ◀ ▶ Hoy con default = hoy
- [ ] Día actual destacado en plan semanal L–V
- [ ] Trabajos por línea con cliente · producto · cantidad · entrega
- [ ] Línea vacía → mensaje claro
- [ ] Resumen: Para hacer / En progreso / Terminadas / Bloqueadas
- [ ] Panel lateral: entregas · problemas · Creamy contextual
- [ ] Acciones visuales por trabajo (sin escritura Sheets)
- [ ] Operario entiende qué hacer en **5 segundos**
