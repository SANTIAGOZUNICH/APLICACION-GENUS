# 15 — Frontend (visión del front-end propio)

> Este documento describe **el front-end ideal de Genus**, como si se construyera desde cero con tecnología moderna. **No habla de la plataforma actual (AppSheet).** Es la visión objetivo: la interfaz con la que Genus alcanza el 100% de la experiencia diseñada. El backend no cambia (ver `16-backend.md`) y se consume vía API (ver `17-api.md`).

---

## 1. Inspiración y referencias

| Referencia | Qué tomamos | Qué NO tomamos |
|---|---|---|
| **SAP Fiori** | Worklist + Object Page; KPI tiles como entrada; status bar de etapas | Complejidad de configuración; densidad enterprise |
| **Monday** | Tableros por estado; color semántico; cards con metadatos | Flexibilidad infinita de columnas |
| **Linear** | Velocidad; "My Issues"; chrome mínimo; atajos de teclado | Enfoque en desarrollo de software |
| **Odoo** | Status bar + flujo por etapas; chatter en object page | Densidad de formularios legacy |
| **Notion** | Limpieza visual; densidad cómoda; contenido como ciudadano de primera | Bloques libres sin estructura |

**Stack sugerido (no prescriptivo):**
- **Framework:** React + Next.js (App Router)
- **Lenguaje:** TypeScript
- **Componentes:** Radix UI + shadcn/ui (accesible, customizable)
- **Estilos:** Tailwind CSS con design tokens de `07` como fuente de verdad
- **Estado servidor:** TanStack Query (React Query)
- **Estado cliente:** Zustand o Context (mínimo)
- **Gráficos:** Recharts o similar (ligero)
- **Iconos:** Lucide React
- **Autenticación:** NextAuth.js con Google Workspace OAuth

Lo esencial no es el stack sino **respetar el Design System y la visión de experiencia**.

---

## 2. Principios de la interfaz

La interfaz materializa la filosofía de `00-vision-general.md`:

1. **El usuario empieza en su trabajo, no en un menú.**
2. **Liderar con la Bandeja Inteligente** (`09`); el resto es secundario.
3. **Calmo, claro, rápido, profesional.**
4. **Cada decisión visual usa los tokens de `07`** — sin excepción.
5. **El front-end no reimplementa reglas de negocio** — las respeta y las refleja, validadas en API.

---

## 3. Arquitectura de la aplicación

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/             # Login, callback OAuth
│   ├── (app)/              # Layout principal con sidebar
│   │   ├── bandeja/        # Bandeja Inteligente (pantalla central)
│   │   ├── produccion/     # Workspace Producción
│   │   ├── calidad/        # Workspace Calidad
│   │   ├── deposito/       # Workspace Inventario/Depósito
│   │   ├── comercial/      # Workspace Comercial
│   │   ├── direccion/      # Workspace Dirección
│   │   ├── dt/             # Workspace Dirección Técnica
│   │   ├── consulta/       # Búsqueda/lookup global
│   │   └── [entidad]/[id]/ # Object pages dinámicas
│   └── api/                # BFF opcional (proxy a API Genus)
├── components/
│   ├── ui/                 # Primitivos (Button, Badge, Card, etc.)
│   ├── cards/              # Task cards específicas (OE, OA, Lote, etc.)
│   ├── layouts/            # Sidebar, Header, Panel
│   ├── forms/              # Formularios guiados
│   └── features/           # Bandeja, Dashboard, Chatter, Creamy
├── lib/
│   ├── api/                # Cliente API, hooks de datos
│   ├── auth/               # Sesión, permisos
│   ├── tokens/             # Design tokens CSS/JS
│   └── utils/              # Helpers
└── types/                  # TypeScript types del dominio
```

---

## 4. Layout general

### 4.1 Estructura de tres zonas

```
┌──────────┬────────────────────────────────┬──────────┐
│          │                                │          │
│ Sidebar  │      Área de trabajo         │  Panel   │
│ (nav)    │      (contenido ~80%)        │ context. │
│          │                                │ (opc.)   │
│          │                                │          │
└──────────┴────────────────────────────────┴──────────┘
```

- **Sidebar:** navegación por Workspaces, filtrada por rol.
- **Área de trabajo:** el contenido principal. La Bandeja o el detalle de una entidad.
- **Panel contextual:** opcional. Detalle rápido, acciones, chat Creamy. Se abre al seleccionar una card sin navegar.

### 4.2 Densidad y ancho

- **Densidad cómoda** (Notion-like): mucho aire, jerarquía por tamaño/peso.
- **Ancho máximo de contenido:** ~1200px para evitar líneas larguísimas.
- **Foco claro:** el elemento principal es el más grande y contrastado.

---

## 5. Sidebar

### Contenido

- **Workspaces de misión** (`08`), filtrados por rol:
  - Producción
  - Calidad
  - Comercial
  - Inventario / Depósito
  - Dirección
  - Dirección Técnica
- **Buscar / Consultar** (lookup global de lotes, órdenes, pedidos).
- **Configuración** (perfil, preferencias, tema claro/oscuro).
- **Creamy** (lanzador del asistente, futuro).

### Comportamiento

- Ítems con ícono + etiqueta.
- Sección activa resaltada (fondo sutil + borde izquierdo azul).
- **Colapsable:** en pantallas chicas o cuando el usuario prefiere más espacio, solo iconos.
- **Lo que NO va en el sidebar:** tablas técnicas como destino. El usuario no navega tablas.

### Filtrado por rol

```typescript
const workspacesForRole = (rolId: string) => {
  const map = {
    'ROL-OP': ['produccion', 'deposito'], // según area
    'ROL-SU': ['produccion'],
    'ROL-CA': ['calidad'],
    'ROL-DT': ['dt'],
    'ROL-AD': ['comercial'],
    'ROL-DI': ['direccion'],
  };
  return map[rolId] ?? [];
};
```

---

## 6. La Bandeja Inteligente (pantalla central)

La materialización de `09-bandeja-inteligente.md`. Es la **pantalla por defecto** al abrir la app.

### Estructura

```
┌─────────────────────────────────────────────────────────┐
│  EL FOCO — Lo próximo que tenés que hacer               │
│  ┌───────────────────────────────────────────────────┐  │
│  │  [Card grande con contexto completo + acción]     │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Pulso del día: ████████░░░░ 8 de 12 completadas        │
│                                                         │
│  ▼ En cola (3)                                          │
│  [Card] [Card] [Card]                                   │
│                                                         │
│  ▼ Problemas (1)                                        │
│  [Card alerta]                                          │
│                                                         │
│  ▶ Esperando a otros (2)                                │
│  ▶ Finalizados hoy (5)                                  │
└─────────────────────────────────────────────────────────┘
```

### Reglas

- **El Foco** ocupa ~80% de la atención visual. Una card grande.
- **Secciones** colapsables: Ahora · En cola · Esperando aprobación · Esperando a otros · Problemas · Finalizados.
- **Pulso del día:** barra de progreso sutil (hecho vs. pendiente).
- **Orden por urgencia** dentro de cada sección.
- **"Problemas" siempre visible** (no colapsado por defecto).
- **Empty state positivo** cuando se vacía: *"No tenés tareas pendientes ✔"*

### Datos

Alimentada por `GET /v1/tasks?assignee=me` (tabla `TAREAS`, futuro) o por agregación de estados de entidades (aproximación actual).

---

## 7. Cards

Implementan la **gramática de card de `07-design-system.md`**:

```
[ícono] · Título · [Badge]
   metadato 1 · metadato 2 · metadato 3
   [urgencia]                    [ACCIÓN PRIMARIA]
```

### Cards específicas

| Componente | Props principales |
|---|---|
| `OECard` | oeId, producto, estado, loteGranel, tamano, responsable, avance, onAction |
| `OACard` | oaId, sku, estado, lotePt, unidades, responsable, avance, onAction |
| `LoteCard` | loteId, item, nroLote, estado, saldo, vencimiento, onAction |
| `LiberacionCard` | loteId, orden, decision, evidencia, diasCuarentena, onAction |
| `PedidoCard` | pedidoId, cliente, estado, compromiso, avanceDespacho, onAction |
| `IncidenciaCard` | tipo, orden, severidad, reporto, fecha, onAction |
| `AlertaCard` | tipo, severidad, contexto, onAction |

### Comportamiento

- Estado siempre como **badge con color de token + ícono**.
- Click en card → Object Page o panel contextual (no tabla).
- Acción primaria en el pie de la card, contextual al estado.

---

## 8. Dashboards / KPIs

Para Supervisor y Dirección. **Secundario** a la Bandeja.

### KPI Tiles (estilo Fiori)

```
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│   12    │ │    5    │ │    3    │ │   87%   │
│ OE curso│ │Cuarent. │ │Espera   │ │Cumplim. │
│   🟠    │ │   🟠    │ │ firma 🟠│ │   🟢    │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
```

- Cada tile es **clickeable** → navega a worklist filtrada.
- Color según semántica (verde/naranja/rojo).
- Número grande, etiqueta clara.

### Gráficos

Solo cuando aportan (tendencias, distribución). Evitar decoración. Ejemplos útiles:
- Lotes en cuarentena por antigüedad (barras).
- Cumplimiento de pedidos del mes (donut).
- Lead time por etapa (cuando haya datos de timestamps).

---

## 9. Object Page (detalle de entidad)

Inspirada en Fiori/Odoo. Se accede al tocar una card o desde búsqueda.

### Estructura

```
┌─────────────────────────────────────────────────────────┐
│ Status Bar: [Planificada]──[En curso]──[Cerrada]──[Lib.]│
├─────────────────────────────────────────────────────────┤
│ OE-0042 · Crema Hidratante Granel          [Cerrar OE] │
│ Estado: En curso 🟠                                     │
├─────────────────────────────────────────────────────────┤
│ ▼ Datos generales                                       │
│ ▼ Consumos de MP (3 de 5)                               │
│ ▼ Controles de proceso                                  │
│ ▼ Trazabilidad                                          │
│ ▼ Actividad / Chatter                                   │
└─────────────────────────────────────────────────────────┘
```

### Secciones

- **Status bar:** etapas del flujo con la actual resaltada.
- **Cabecera:** identidad, badge, acción primaria.
- **Datos:** información de la entidad.
- **Relacionados:** consumos, análisis, movimientos.
- **Trazabilidad:** cadena hacia atrás/adelante.
- **Chatter:** comentarios y log del objeto (futuro, `11-comunicacion.md`).

---

## 10. Workspaces

Cada Workspace (misión) es una vista compuesta de secciones (decks de cards), filtrada por el rol como lente (`08-workspaces.md`).

### Vocabulario de secciones (canónico)

| Sección | Significado |
|---|---|
| Ahora | Lo que tengo que hacer ya |
| En cola | Asignado, no empezado |
| Esperando aprobación | Requiere mi decisión |
| Esperando a otros | Hice mi parte, depende de otro |
| Problemas | Excepciones que requieren atención |
| Finalizados | Completado reciente (colapsado) |

El mismo vocabulario en todos los Workspaces. Solo cambia cuál es el foco según misión/rol.

---

## 11. Formularios guiados

### Principios

- **Un paso a la vez.** No abrumar con todos los campos.
- **Revelado progresivo.** Solo campos del paso actual.
- **Validación inline.** Al salir del campo, no al final.
- **Confirmación** antes de lo irreversible.
- **Mensajes de error accionables** ("qué pasó + cómo resolver").

### Ejemplo: Consumo de MP en OE

```
Paso 1: Escanear/seleccionar lote
  [Campo lote con escáner integrado]
  → Validación: existe, es MP correcta, liberado, no vencido

Paso 2: Ingresar cantidad
  [Campo cantidad]
  → Validación: ≤ saldo, dentro de tolerancia

Paso 3: Confirmar
  [Resumen: lote X, cantidad Y]
  [Confirmar] [Cancelar]
```

### Escaneo

- Integración con cámara del dispositivo o lector Bluetooth.
- Al escanear, autocompletar lote y validar inmediatamente.
- Feedback visual/sonoro de éxito o error.

---

## 12. Acciones

| Regla | Implementación |
|---|---|
| Una acción primaria por pantalla | Botón azul destacado |
| Contextual al estado | Solo acciones válidas visibles |
| RBAC del lado servidor | API rechaza si no tiene permiso |
| Atajos de teclado (desktop) | Estilo Linear: `Enter` confirmar, `Esc` cancelar |
| Confirmación en irreversible | Modal antes de cerrar, firmar, despachar |

---

## 13. Chatbot (Creamy)

Panel/lanzador persistente (`10-chatbot-creamy.md`):

- Accesible desde cualquier Workspace (ícono en sidebar o FAB).
- Panel lateral o modal de chat.
- Respuestas con **cita de fuente** (POE/especificación).
- **Recomendación de derivación** cuando corresponde.
- Respeta RBAC del usuario (no expone datos no autorizados).

---

## 14. Responsive

### Móvil primero para planta

- **Usuarios:** operario, depósito.
- **Características:** objetos grandes (min 44px touch), escaneo, una tarea a la vez, sidebar colapsado/hamburguesa.
- **Layout:** single column, foco full-width.

### Desktop para supervisión

- **Usuarios:** supervisor, calidad, DT, dirección.
- **Características:** densidad media, dashboards, multi-panel, atajos de teclado.
- **Layout:** sidebar fijo + área de trabajo + panel contextual opcional.

### Tablet de planta

- Layout fluido entre breakpoints.
- Nada se rompe en tablet usada en producción.

---

## 15. Dark mode

- Soportado vía tokens CSS (ver `07-design-system.md` §2.2).
- Toggle en configuración o preferencia del sistema.
- El color **mantiene su significado** en ambos temas.
- Contraste accesible (WCAG AA).

---

## 16. Animaciones

**Sobrias y con propósito:**

| Animación | Cuándo | Duración |
|---|---|---|
| Tarea completada → sale | Al confirmar acción | 200ms ease-out |
| Siguiente tarea → aparece | Después de completar | 150ms ease-in |
| Guardado exitoso | Feedback de acción | 100ms check |
| Transición de página | Navegación | 150ms |

Nunca decorativas ni lentas. Refuerzan sensación de "vivo" y progreso.

---

## 17. UX — reglas transversales

1. El usuario **nunca** se pregunta "¿a qué módulo entro?".
2. **Cero tablas para trabajar**; tablas solo para consultar/auditar.
3. Consistencia total con el Design System (`07`).
4. **Accesibilidad:** contraste, foco visible, navegación por teclado, tap targets grandes.
5. **Rendimiento percibido:** skeleton loaders, datos progresivos, optimistic updates en acciones rápidas.
6. **Offline parcial (futuro):** cache de tareas para consulta; sync al reconectar.

---

## 18. Relación con el backend

El front-end es **otra interfaz** sobre el mismo backend (`16-backend.md`):

- Toda la lógica de negocio, RBAC, append-only y flujos GMP vive en backend/API.
- El front consume la API (`17-api.md`).
- El front **no reimplementa** reglas críticas: las respeta y las refleja.
- Toda validación crítica se **revalida en servidor**.

---

## 19. Relación con otros documentos

| Documento | Contenido |
|---|---|
| `07-design-system.md` | Tokens y componentes a implementar |
| `08-workspaces.md` | Estructura de cada Workspace |
| `09-bandeja-inteligente.md` | Lógica de la pantalla central |
| `17-api.md` | Contratos de API a consumir |
| `20-recomendaciones-cursor.md` | Cómo construir sin romper principios |
