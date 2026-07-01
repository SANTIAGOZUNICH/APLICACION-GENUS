# 21 — Modelo operativo de Genus OS (F8)

> **Estado:** Especificación funcional para revisión y aprobación.  
> **Alcance F8:** Rediseño operativo del producto. **No incluye login ni autenticación.**  
> **Prerequisito técnico:** Data Discovery (E7.2) debe confirmar schemas reales antes de implementar mappers.

---

## 1. Por qué este documento existe

Genus OS se construyó inicialmente alrededor de **entidades** (OE, OA, Pedido, Lote, Liberación). Ese modelo refleja el **diccionario de datos GMP**, pero **no refleja cómo trabaja el laboratorio día a día**.

En la planta, nadie entra a “buscar una OE”. Entra a saber:

- qué tiene que hacer **hoy**,
- qué hizo,
- qué le queda pendiente,
- qué está bloqueado.

El trabajo nace en la **planificación semanal**, se reparte por **sector**, se ejecuta como **tarea del día**, y recién entonces genera o referencia **entidades documentales** (OE, OA, pedido, lote).

**F8 remodela Genus OS alrededor de la operación real**, respetando la arquitectura técnica ya construida (Store, Adapters, BFF, Drive, Sheets, Excel), pero cambiando el **modelo funcional** y el **punto de entrada** del usuario.

### 1.1 Qué cambia y qué no

| Cambia | No cambia (por ahora) |
|--------|------------------------|
| Centro de gravedad: **WorkItem** (tarea operativa) | Backend de producción: Google Sheets / Excel en Drive |
| Home del usuario: **Mi trabajo** por sector | Principios GMP: trazabilidad, segregación, estados derivados |
| Planificación: **SEMANAS 2026** como fuente principal | Arquitectura: Adapters → BFF → Store → UI |
| Mappers: planilla → **WorkItem** → pantalla | Entidades OE/OA/Lote/Pedido siguen existiendo como consecuencia |
| Acceso futuro: **1 email = 1 sector** | Login, OAuth, escritura en Sheets, automatizaciones |

### 1.2 Regla de oro

> **No mapear planillas directamente a Cards.**  
> **No parchear la UI entity-centric actual.**  
> Primero: discovery + contrato de mappers. Después: WorkItems. Después: pantallas.

---

## 2. Cómo trabaja realmente el laboratorio

### 2.1 Jerarquía operativa (no entity-centric)

```
Plan semanal (SEMANAS 2026)
        ↓
Sector (Elaboración, Envasado Masivo, Premium, Codificado, MP, Calidad, …)
        ↓
Trabajo del día (WorkItem)
        ↓
Acción (abrir OE, crear OA, registrar avance, cargar análisis, …)
        ↓
Entidades documentales (Pedido / Lote / OE / OA / Liberación)
```

Las entidades **existen** y son necesarias para GMP, pero son **consecuencia** del trabajo, no el punto de partida del operario.

### 2.2 Fuentes de verdad del laboratorio

El laboratorio no tiene “una base de datos”. Tiene **planillas maestras** en Google Drive que cumplen roles distintos:

| # | Fuente | Archivo / carpeta | Rol operativo | Rol documental |
|---|--------|-------------------|---------------|----------------|
| 1 | **Plan semanal** | `SEMANAS 2026` (PCP) | **Tablero principal** — qué se hace, cuándo, en qué línea/sector | Origen de WorkItems |
| 2 | **Pedidos comerciales** | `PEDIDOS 2026` (PCP, Excel o Sheet) | Demanda, compromisos, OP/OC, prioridad comercial | Referencia cruzada en WorkItems |
| 3 | **Asignación de lotes** | `ASIGNACION DE LOTES 2026` (LOTES) | Trabajo de **Calidad** — lotes, análisis, OE/OA/RL | Origen de WorkItems de calidad |
| 4 | **Detalle de elaboración** | Carpeta `ELABORACION` (un archivo ≈ una OE) | **Detalle documental** de una orden ya planificada | No es el tablero; es la ficha |

**Implicación de producto:**

- Un operario de Envasado Masivo **no** debería entrar por “lista de OEs”.
- Debería entrar por **“qué tengo que hacer hoy según SEMANAS 2026”**.
- La carpeta ELABORACION se abre **desde** un WorkItem cuando la acción lo requiere (“Abrir OE”).

### 2.3 Relación entre fuentes

```
                    SEMANAS 2026
                   /      |      \
          Elaboración  Acondicionamiento  Entregas
                |            |              |
           WorkItems     WorkItems      WorkItems
                |            |              |
           Abrir OE      Crear/Abrir OA   Seguir pedido
                |            |              |
         ELABORACION/    OA (Sheet)    PEDIDOS 2026
           archivo OE         |              |
                \            |             /
                 \------ Lote / RL -------/
                         (ASIGNACION DE LOTES 2026)
```

---

## 3. Modelo canónico: WorkItem

`WorkItem` es la unidad mínima de **trabajo operativo** en Genus OS. Todo lo que el usuario ve en “Mi trabajo”, “Plan semanal” o resultados de consulta operativa debe poder reducirse a WorkItems (más entidades cuando abre el detalle).

### 3.1 Definición

Un **WorkItem** representa **una tarea real asignable a un sector**, con trazabilidad a la celda/fila de origen en la planilla.

### 3.2 Campos mínimos

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `id` | string | Sí | Identificador estable derivado de fuente + posición (ej. `semanas:2026-W27:elaboracion:row-42`) |
| `sector` | SectorId | Sí | Sector responsable de ejecutar |
| `source` | enum | Sí | `semanas_2026` \| `pedidos_2026` \| `asignacion_lotes_2026` \| `elaboracion_index` |
| `sourceFileId` | string | Sí* | ID Drive del archivo origen (*index ELABORACION puede usar fileId del índice) |
| `sourceSheet` | string | Cond. | Nombre de pestaña / hoja |
| `sourceRange` | string | Cond. | Rango A1 o referencia lógica (fila N, columna bloque) |
| `date` | ISO date | Cond. | Fecha operativa del trabajo |
| `dayLabel` | string | Cond. | Etiqueta humana: “Lunes”, “Martes 14/07” |
| `weekLabel` | string | Cond. | Etiqueta de semana: “Semana 27 · Julio 2026” |
| `client` | string | No | Cliente / marca |
| `product` | string | No | Producto / granel / SKU |
| `quantity` | string/number | No | Cantidad planificada |
| `unit` | string | No | kg, unidades, L, etc. |
| `line` | string | No | Línea de producción / acondicionamiento |
| `deliveryDate` | ISO date | No | Compromiso de entrega (desde pedidos o semanas) |
| `status` | WorkItemStatus | Sí | Estado operativo del ítem (ver §3.3) |
| `priority` | enum | No | `alta` \| `media` \| `baja` — derivado o explícito |
| `pedidoRef` | string | No | Referencia a pedido (PED-…, OP, OC) |
| `oeRef` | string | No | Referencia OE (ID de negocio o slug de archivo) |
| `oaRef` | string | No | Referencia OA |
| `loteRef` | string | No | Referencia lote |
| `notes` | string | No | Observaciones de la planilla |
| `actionLabel` | string | Sí | Acción primaria sugerida: “Abrir OE”, “Crear OA”, “Cargar análisis” |
| `href` | string | Cond. | Ruta interna Genus (`/oe/…`, `/oa/…`, `/mi-trabajo/…`) |
| `confidence` | enum | Sí | `high` \| `medium` \| `low` — qué tan seguro está el mapper del mapeo |

### 3.3 Estados de WorkItem (`WorkItemStatus`)

Estados **operativos**, no estados GMP de entidad:

| Estado | Significado |
|--------|-------------|
| `pendiente` | Asignado, no iniciado |
| `en_curso` | En ejecución |
| `bloqueado` | No puede avanzar (falta insumo, calidad, decisión) |
| `completo` | Trabajo del ítem terminado |
| `revision` | Esperando revisión / firma |
| `cancelado` | Ya no aplica (plan cambió) |

> **Importante:** Un WorkItem `completo` no implica que la OE esté “Cerrada” en GMP. La entidad tiene su propio ciclo de vida. El WorkItem refleja **el trabajo del tablero semanal**.

### 3.4 Pipeline de datos (obligatorio)

```
Planilla real (Drive)
        ↓
   Data Discovery (schemas confirmados)
        ↓
   Mapper específico → WorkItem[]
        ↓
   Store / BFF (filtro por sector, fecha, estado)
        ↓
   UI (Mi trabajo, Plan semanal, Consulta)
        ↓
   Acción → Entidad (OE/OA/Lote) solo cuando corresponde
```

**Prohibido:** `Sheet row → EntityCard` sin pasar por WorkItem.

### 3.5 Mappers nuevos (contrato F8)

| Mapper | Fuente | Produce WorkItems para sectores |
|--------|--------|----------------------------------|
| `semanas-elaboracion-to-work-items.ts` | SEMANAS 2026 · pestaña/bloque Elaboración | ELABORACION, MATERIA_PRIMA (parcial) |
| `semanas-acondicionamiento-to-work-items.ts` | SEMANAS 2026 · Acondicionamiento | ENVASADO_MASIVO, ENVASADO_PREMIUM |
| `semanas-entregas-to-work-items.ts` | SEMANAS 2026 · Entregas | COMERCIAL, DEPOSITO, DIRECCION |
| `pedidos-to-work-items.ts` | PEDIDOS 2026 | COMERCIAL, PRODUCCION, DIRECCION |
| `lotes-to-work-items.ts` | ASIGNACION DE LOTES 2026 | CALIDAD, PRODUCCION |

Cada mapper debe emitir `confidence` y `fieldsMissing` cuando no pueda resolver un campo obligatorio del contrato.

---

## 4. Modelo canónico: OrdenAcondicionamiento (OA)

La OA es una entidad GMP existente. F8 la formaliza como **objeto que nace desde un WorkItem**, no como registro suelto.

### 4.1 Campos

| Campo | Descripción |
|-------|-------------|
| `oaId` | Identificador de negocio |
| `sector` | ENVASADO_MASIVO \| ENVASADO_PREMIUM \| … |
| `sourceWorkItemId` | WorkItem que originó la OA |
| `fecha` | Fecha planificada / real |
| `cliente` | Cliente / marca |
| `producto` | PT / SKU |
| `cantidadPlanificada` | Unidades planificadas |
| `cantidadReal` | Unidades producidas |
| `linea` | Línea de acondicionamiento |
| `loteGranel` | Granel origen (debe estar liberado) |
| `lotePT` | Lote PT resultante |
| `estado` | Ver §4.2 |
| `materiales` | ME consumidos (referencia OA_MATERIALES) |
| `responsable` | Operario asignado |
| `observaciones` | Texto libre |
| `creadaPor` | Usuario / sector que creó |
| `ultimaActualizacion` | Timestamp |

### 4.2 Estados OA

| Estado | Significado |
|--------|-------------|
| `Pendiente` | Creada o planificada, no iniciada |
| `En curso` | Acondicionamiento en ejecución |
| `Bloqueada` | Detenida por falta, calidad o incidencia |
| `Completa` | Acondicionamiento terminado (pendiente cierre formal) |
| `Revisión` | En revisión / control antes de cierre |

### 4.3 Regla de nacimiento

- **Flujo normal:** WorkItem de Acondicionamiento → acción “Crear OA” / “Abrir OA” → `OrdenAcondicionamiento` vinculada a `sourceWorkItemId`.
- **Excepción:** PRODUCCION y DIRECCION pueden crear OA fuera de un WorkItem (replanificación, urgencia). Esas OA deben quedar marcadas como `origen: manual` y auditadas.

---

## 5. Sectores oficiales

### 5.1 Catálogo

| SectorId | Nombre visible | Email futuro (1:1) |
|----------|----------------|---------------------|
| `ELABORACION` | Elaboración | `elaboracion@laboratoriogenus.com.ar` |
| `ENVASADO_MASIVO` | Envasado Masivo | `emasivo@laboratoriogenus.com.ar` |
| `ENVASADO_PREMIUM` | Envasado Premium | `epremium@laboratoriogenus.com.ar` |
| `CODIFICADO` | Codificado | `codificado@laboratoriogenus.com.ar` |
| `MATERIA_PRIMA` | Materia Prima | `materiaprima@laboratoriogenus.com.ar` |
| `CALIDAD` | Calidad | `calidad@laboratoriogenus.com.ar` |
| `DEPOSITO` | Depósito | *(a definir — puede compartir rol operario depósito existente)* |
| `COMERCIAL` | Comercial | *(a definir)* |
| `PRODUCCION` | Producción (supervisión transversal) | `produccion@laboratoriogenus.com.ar` |
| `DIRECCION` | Dirección | `direccion@laboratoriogenus.com.ar` |

> **Nota:** DEPOSITO y COMERCIAL no tienen email en el brief F8; se reservan en el enum y se completan antes de login.

### 5.2 Selector manual (F8)

Hasta implementar login, la app usa un **selector de sector** en `/mi-trabajo`. Simula “Hola, {Sector}” sin autenticación. El sector elegido filtra WorkItems y acciones visibles.

---

## 6. RBAC futuro (preparar, no implementar)

### 6.1 Principio de acceso F8+

- **Un email → un único sector** (no multi-sector en MVP login).
- El sector define **scope de lectura** (qué WorkItems ve) y **acciones** (qué puede hacer).
- PRODUCCION y DIRECCION tienen scope ampliado; sectores operativos ven solo su línea.

### 6.2 Archivo de configuración (futuro)

`frontend/src/config/sector-access.ts` (o equivalente en backend para BFF):

```typescript
// ESPECIFICACIÓN — NO IMPLEMENTAR AUTH EN F8
export interface SectorAccessConfig {
  sector: SectorId;
  email: string;
  scope: {
    workItemSources: ("semanas_2026" | "pedidos_2026" | "asignacion_lotes_2026")[];
    semanasBlocks?: string[];  // ej. ["ELABORACION"] o ["ACONDICIONAMIENTO", "ENVASADO CONSUMO MASIVO"]
    readSectors?: SectorId[];  // PRODUCCION ve todos; MASIVO no ve PREMIUM
  };
  permissions: {
    actions: string[];  // ej. "oa.create", "oa.complete", "oe.open", "analysis.load"
  };
}
```

### 6.3 Matriz resumida sector → acciones (objetivo post-login)

| Sector | Acciones principales |
|--------|----------------------|
| ELABORACION | Abrir OE, marcar avance, registrar observaciones |
| ENVASADO_MASIVO | Abrir/crear/completar OA, registrar unidades, bloqueos |
| ENVASADO_PREMIUM | Idem Masivo, solo su línea Premium |
| CODIFICADO | Marcar codificado OK / Pendiente / Bloqueado |
| MATERIA_PRIMA | Ver elaboraciones del día, preparar MP, marcar faltantes |
| CALIDAD | Cargar análisis, completar resultados, liberar, bloquear |
| DEPOSITO | Movimientos, despachos, recepciones (WorkItems de entregas) |
| COMERCIAL | Seguimiento pedidos, prioridades |
| PRODUCCION | Reasignar, crear OA/OE, ver problemas y atrasos (todos los sectores operativos) |
| DIRECCION | Dashboard, KPIs, lectura integral |

La matriz `PERMISOS` existente (`04-rbac.md`) sigue vigente para **entidades GMP**. El sector-access es una **capa operativa** encima, alineada al trabajo diario.

---

## 7. Ficha por sector

Para cada sector: misión, fuentes, WorkItems, pantallas, acciones, visibilidad, entidades que genera.

---

### 7.1 ELABORACION

**Misión:** Ejecutar la elaboración planificada del día/semana.

| Tema | Detalle |
|------|---------|
| **Fuente de verdad del trabajo** | `SEMANAS 2026` → bloque **Elaboración** |
| **Fuente de verdad del detalle** | Carpeta `ELABORACION` (archivo por OE) |
| **Fuente cruzada** | `PEDIDOS 2026` (cliente, OP, compromiso) |
| **WorkItems que consume** | Mapper `semanas-elaboracion-to-work-items` |
| **Qué ve** | Hoy · Esta semana · Producto · Kg · Cliente · OE (ref) |
| **Qué NO ve** | Acondicionamiento Premium/Masivo, análisis de calidad, dashboard dirección |
| **Acciones** | Abrir OE · Marcar avance · Registrar observaciones |
| **Entidades que genera/toca** | OE (documento), eventualmente consumos MP (futuro) |

**Saludo UI:** “Hola Elaboración”

**Secciones Mi trabajo:** Para hacer hoy · Esta semana · En curso · Pendientes · Bloqueados

---

### 7.2 ENVASADO MASIVO

**Misión:** Acondicionar productos de la línea consumo masivo según plan semanal.

| Tema | Detalle |
|------|---------|
| **Usuario futuro** | `emasivo@laboratoriogenus.com.ar` |
| **Fuente de verdad del trabajo** | `SEMANAS 2026` → **Acondicionamiento** → sub-bloque **ENVASADO CONSUMO MASIVO** |
| **WorkItems que consume** | Mapper `semanas-acondicionamiento-to-work-items` (filtro línea Masivo) |
| **Qué ve** | Qué hacer hoy · Esta semana · Órdenes de acondicionamiento · Pendientes · Bloqueados |
| **Qué NO ve** | **Premium** (regla estricta de aislamiento) |
| **Acciones** | Abrir OA · Crear OA · Completar OA · Registrar avance · Registrar unidades · Observaciones · Marcar bloqueos |
| **Entidades que genera** | `OrdenAcondicionamiento` (sector = ENVASADO_MASIVO), lote PT (futuro) |

**Saludo UI:** “Hola Envasado Masivo”

---

### 7.3 ENVASADO PREMIUM

**Misión:** Igual que Masivo, para la línea Premium.

| Tema | Detalle |
|------|---------|
| **Usuario futuro** | `epremium@laboratoriogenus.com.ar` |
| **Fuente** | `SEMANAS 2026` → Acondicionamiento → **ENVASADO PRODUCTOS PREMIUM** |
| **Qué NO ve** | Masivo |
| **Acciones** | Abrir/crear/completar OA · Avance · Observaciones (sin duplicar reglas de unidades si el schema Premium difiere — confirmar en discovery) |
| **Entidades** | OA sector PREMIUM |

---

### 7.4 CODIFICADO

**Misión:** Completar codificación de productos pendientes.

| Tema | Detalle |
|------|---------|
| **Fuente de verdad** | `SEMANAS 2026` (bloque a confirmar en discovery — puede ser Acondicionamiento post-OA o bloque dedicado) |
| **Qué ve** | Solo productos **pendientes de codificar** |
| **Acciones** | Marcar: **Codificado OK** · **Pendiente** · **Bloqueado** |
| **Entidades** | Ninguna GMP pesada en F8; actualización de estado en WorkItem / OA |

---

### 7.5 MATERIA PRIMA

**Misión:** Preparar insumos para las elaboraciones del día.

| Tema | Detalle |
|------|---------|
| **Fuente de verdad** | `SEMANAS 2026` → Elaboración (lectura) + necesidades derivadas |
| **Qué ve** | Elaboraciones que se preparan hoy · MP a preparar · Faltantes |
| **Acciones** | Marcar preparado · Reportar faltante · Observaciones |
| **Entidades** | Referencia a lotes MP (lectura); movimientos = fase posterior |

---

### 7.6 CALIDAD

**Misión:** Analizar, disponer y liberar lotes.

| Tema | Detalle |
|------|---------|
| **Fuente de verdad principal** | `ASIGNACION DE LOTES 2026` |
| **WorkItems que consume** | Mapper `lotes-to-work-items` |
| **Qué ve** | Lotes · Análisis · OE · OA · RL · Observaciones |
| **Qué NO ve** | Planificación comercial detallada, codificado |
| **Acciones** | Cargar análisis · Completar resultados · Liberar · Bloquear |
| **Entidades** | ANÁLISIS_CALIDAD, LIBERACIONES (futuro), referencias a OE/OA/Lote |

---

### 7.7 DEPOSITO

**Misión:** Mover stock — recepciones y despachos.

| Tema | Detalle |
|------|---------|
| **Fuente de verdad del trabajo** | WorkItems de **Entregas** (`semanas-entregas-to-work-items`) + pedidos listos |
| **Fuente cruzada** | `PEDIDOS 2026`, saldos (futuro) |
| **Qué ve** | Despachos del día · Recepciones pendientes · Bloqueos de stock |
| **Acciones** | Registrar movimiento · Despachar (fase posterior con validaciones GMP) |

---

### 7.8 COMERCIAL

**Misión:** Cumplir pedidos a tiempo.

| Tema | Detalle |
|------|---------|
| **Fuente de verdad** | `PEDIDOS 2026` |
| **WorkItems** | `pedidos-to-work-items` |
| **Qué ve** | Pedidos en riesgo · En producción · Compromisos · Observaciones |
| **Acciones** | Seguimiento · Escalar · Consultar (sin cerrar producción) |

---

### 7.9 PRODUCCION

**Misión:** Coordinar todos los sectores operativos.

| Tema | Detalle |
|------|---------|
| **Usuario futuro** | `produccion@laboratoriogenus.com.ar` |
| **Fuentes** | `SEMANAS 2026` (completo) + `ASIGNACION DE LOTES` + `PEDIDOS` + índice ELABORACION |
| **Qué ve** | **Todos** los sectores operativos · Problemas · Atrasos · Reasignaciones |
| **Acciones** | Reasignar · Crear OA · Crear OE · Ver problemas |
| **Alcance especial** | Puede crear entidades fuera de WorkItem (auditado) |

---

### 7.10 DIRECCION

**Misión:** Visión ejecutiva y excepciones.

| Tema | Detalle |
|------|---------|
| **Usuario futuro** | `direccion@laboratoriogenus.com.ar` |
| **Fuentes** | Agregación de todas + KPIs |
| **Qué ve** | Dashboard · KPIs · Pedidos · Producción · Entregas · Indicadores |
| **Acciones** | Lectura · Profundizar excepciones · Escalar (sin operar planta) |

---

## 8. Pantallas nuevas (F8)

### 8.1 `/mi-trabajo` — Home del usuario

**Reemplaza conceptualmente** a “entrar y buscar entidades”.

Estructura:

```
[Selector de sector — manual en F8]

Hola {Nombre del sector}

├── Para hacer hoy
├── Esta semana
├── {Sección específica del sector — ej. Mis OA, Lotes, Productos a codificar}
├── Pendientes
└── Bloqueados
```

Cada ítem es un **WorkItem** renderizado con: producto, cliente, cantidad, fecha, estado, acción primaria.

**No muestra:** listas crudas de entidades sin contexto de trabajo.

### 8.2 `/plan-semanal`

Representación de `SEMANAS 2026`:

```
Semana {N}
├── Lunes
│   ├── Elaboración
│   │   └── Línea / filas → WorkItems
│   ├── Acondicionamiento
│   │   ├── Masivo
│   │   └── Premium
│   └── Entregas
├── Martes
│   └── …
```

Solo lectura operativa en F8 (escritura = fase posterior).

### 8.3 `/consulta` (evolución)

Búsqueda unificada sobre:

- WorkItems (prioritario)
- Pedidos
- Lotes
- OE / OA
- Cliente / Producto

Resultados con **origen** y **confidence** del mapper. No mezclar entidades mal mapeadas sin etiqueta.

---

## 9. Relación con arquitectura técnica existente

```
Google Drive / Sheets / Excel
        ↓
OperationsDocumentRepository (índice, refresh)
        ↓
Discovery endpoints (E7.2) — schemas
        ↓
WorkItem mappers (F8) — NUEVO
        ↓
BFF /api/v1/work-items, /api/v1/plan-semanal, …
        ↓
OperationsStore (extender state.workItemsBySector)
        ↓
UI Mi trabajo / Plan semanal
        ↓
Entity pages (/oe, /oa) — detalle bajo demanda
```

**Reutilizar:**

- `operations-document-repository`, resolvers, `sheetsReader`, `excelReader`
- Patrón BFF + `operations-client`
- Entity pages existentes como **drill-down**, no como home

**Deprecar gradualmente:**

- Workspaces entity-centric como home (Bandeja llena de OEs, cards inventadas)
- Mappers directos a `BandejaTask` / `EntityCard` sin WorkItem

---

## 10. Data Discovery — prerequisito obligatorio

Antes de implementar mappers F8, deben estar confirmados (vía `/api/v1/discovery/*`):

| Fuente | Qué confirmar |
|--------|---------------|
| SEMANAS 2026 | Pestañas, bloques Elaboración/Acondicionamiento/Entregas, fila header, columnas por sector |
| PEDIDOS 2026 | Headers Excel/Sheet, columnas pedido/cliente/producto/OP/OC/fechas |
| ASIGNACION LOTES | Headers, columnas lote/producto/marca/OE/OA/RL |
| ELABORACION | Layout label-value vs tabular en OEs sample |

**Criterio para avanzar a UI de sectores:**

- `lotesRowsMappable > 0`
- `pedidosRowsMappable > 0`
- Campos OE obligatorios detectados en muestra
- Aliases de columnas SEMANAS confirmados por sector/bloque

---

## 11. Orden de implementación (después de aprobar este doc)

| Fase | Contenido | Dependencias |
|------|-----------|--------------|
| **F8.0** | Aprobar este documento + completar discovery SEMANAS | E7.2 discovery |
| **F8.1** | Tipos WorkItem + mappers SEMANAS (elaboración + acondicionamiento) | Schemas SEMANAS |
| **F8.2** | `/mi-trabajo` + selector sector + mappers lotes/pedidos | F8.1 |
| **F8.3** | `/plan-semanal` | F8.1 |
| **F8.4** | Modelo OA canónico + acciones crear/abrir/completar (lectura primero) | F8.2 |
| **F8.5** | Consulta sobre WorkItems | F8.1 |
| **Login** | Google OAuth + email → sector | `sector-access.ts` |
| **RBAC** | Enforce scope por sector | Login |
| **Escritura Sheets** | Marcar avance, estados WorkItem, OA | RBAC + validación |
| **Automatizaciones** | Postas entre sectores | Escritura |
| **Notificaciones** | Slack / in-app | Automatizaciones |

---

## 12. Qué NO hacer en F8

1. **No implementar login** ni Google OAuth.
2. **No parchear** Bandeja/Workspaces actuales con datos mal mapeados.
3. **No inventar** responsables, progreso %, estados EN_CURSO si no vienen de la planilla.
4. **No mostrar** “estás al día” cuando faltan fuentes o mappers.
5. **No mezclar** Masivo y Premium en la misma vista operativa.
6. **No mapear** directo a Cards — siempre WorkItem intermedio.
7. **No escribir** en Sheets hasta tener RBAC y reglas de auditoría.

---

## 13. Tabla de trazabilidad: sector → fuente → WorkItem → entidad

| Sector | Fuente primaria | Mapper | WorkItem típico | Entidad al actuar |
|--------|-----------------|--------|-----------------|-------------------|
| ELABORACION | SEMANAS · Elaboración | semanas-elaboracion | “Elaborar {producto} {kg}” | OE (archivo ELABORACION) |
| ENVASADO_MASIVO | SEMANAS · Acond. Masivo | semanas-acondicionamiento | “Acondicionar {SKU}” | OA |
| ENVASADO_PREMIUM | SEMANAS · Acond. Premium | semanas-acondicionamiento | Idem | OA |
| CODIFICADO | SEMANAS | semanas-acondicionamiento / entregas | “Codificar {producto}” | OA (estado) |
| MATERIA_PRIMA | SEMANAS · Elaboración | semanas-elaboracion | “Preparar MP para {OE}” | — (fase 2: MP/lotes) |
| CALIDAD | ASIGNACION LOTES | lotes-to-work-items | “Analizar lote {L-}” | Análisis / Liberación |
| DEPOSITO | SEMANAS · Entregas | semanas-entregas | “Despachar {pedido}” | Movimiento (futuro) |
| COMERCIAL | PEDIDOS 2026 | pedidos-to-work-items | “Seguir {pedido}” | Pedido (lectura) |
| PRODUCCION | Todas | Agregador | Cualquiera | OE/OA manual |
| DIRECCION | Agregado | KPIs | Excepciones | Lectura |

---

## 14. Glosario operativo F8

| Término | Significado en F8 |
|---------|-------------------|
| **WorkItem** | Tarea operativa mapeada desde planilla, unidad de “Mi trabajo” |
| **Sector** | Unidad organizativa del laboratorio; filtra qué WorkItems ve el usuario |
| **Plan semanal** | Contenido de SEMANAS 2026; autoridad sobre el trabajo del período |
| **Detalle ELABORACION** | Archivo individual de OE; se abre desde WorkItem, no lista suelta |
| **Confidence** | Confianza del mapper en el mapeo columna→campo |
| **Origen manual** | OA/OE creada por Producción/Dirección fuera de WorkItem |

---

## 15. Criterios de aceptación del documento

Este documento se considera **aprobado** cuando el equipo confirma:

1. La jerarquía Plan → Sector → WorkItem → Acción → Entidad refleja la operación real.
2. Las cuatro fuentes de verdad están correctamente priorizadas (SEMANAS como tablero principal).
3. Cada sector tiene claro qué ve, qué no ve, y qué acciones tiene.
4. El modelo WorkItem y OA canónico son suficientes para diseñar mappers sin ambigüedad.
5. El orden Login → OAuth → RBAC → Escritura → Automatizaciones → Notificaciones es aceptado.
6. No se autoriza implementación de UI sectorial hasta cerrar discovery de **SEMANAS 2026**.

---

## 16. Referencias cruzadas

| Documento | Relación |
|-----------|----------|
| `05-flujos-operativos.md` | Cadena GMP Pedido→…→Despacho (entidades) |
| `08-workspaces.md` | Workspaces v1 entity-centric — **supersedido en espíritu por F8** |
| `03-modelo-de-datos.md` | Diccionario entidades GMP (sigue vigente) |
| `04-rbac.md` | RBAC por rol/módulo — complementado por sector-access |
| `17-api.md` | Evolucionar BFF con `/work-items`, `/plan-semanal` |
| E7.2 Discovery | Prerequisito técnico inmediato |

---

*Documento generado para revisión — F8 Rediseño Operativo Genus OS. No implementar código hasta aprobación explícita.*
