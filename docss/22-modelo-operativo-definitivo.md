# 22 — Modelo operativo definitivo de Genus OS (F8.0)

> **Estado:** **APROBADO** — Constitución funcional vigente (F8.0 + enmiendas F8.1).  
> **Reemplaza:** cualquier interpretación anterior, incluido `21-modelo-operativo-genus.md`.  
> **Implementación:** F8.1 en curso — motor operativo (WorkItems, Discovery SEMANAS). UI definitiva después.

---

## Prefacio

Este documento describe **cómo funciona el laboratorio Genus** y **cómo el software debe representar esa operación**.

No describe cómo está programado el sistema hoy. Es la referencia obligatoria para todo desarrollo posterior.

Un desarrollador nuevo debe poder entender el laboratorio **sin abrir una sola planilla**, leyendo solo este documento y los flujos GMP de `05-flujos-operativos.md`.

---

# 1. Filosofía del sistema

## 1.1 El error del modelo anterior

Genus OS se modeló como un ERP **centrado en entidades**:

```
OE → OA → Pedido → Lote → Liberación
```

Eso refleja el **diccionario de datos GMP**, pero **no refleja la operación diaria**.

En planta, nadie piensa: *“voy a buscar la OE-1234”*. Piensa: *“hoy me toca elaborar la crema de Icono”* o *“tengo que acondicionar el batch de la línea masiva del martes”*.

## 1.2 El modelo correcto

Genus OS es un sistema centrado en:

```text
Persona
    ↓
Sector
    ↓
Trabajo
    ↓
Acción
    ↓
Documento
```

**NO al revés.**

| Orden correcto | Orden incorrecto (descartado) |
|----------------|-------------------------------|
| La persona entra y ve **su trabajo** | La persona entra y navega **entidades** |
| El sector define **qué ve y qué hace** | Un menú genérico muestra todo |
| El trabajo nace del **plan semanal** | Las cards se arman desde índices sueltos |
| La acción produce o abre un **documento** | El documento es el punto de entrada |
| OE/OA/Lote son **consecuencia** del trabajo | OE/OA/Lote son el **centro** del producto |

## 1.3 Principios no negociables

1. **Una fuente oficial por dato.** Si un dato existe en dos planillas, solo una manda; la otra referencia o deriva.
2. **El plan manda.** `SEMANAS 2026` es la autoridad del trabajo operativo del período.
3. **El sector acota la vista.** Masivo no ve Premium. Elaboración no libera lotes.
4. **No inventar.** Si el schema no está confirmado (Discovery), no se muestra como real.
5. **Segregación GMP.** Quien ejecuta no firma. Quien produce no dispone. (Ver `04-rbac.md` para entidades; este doc para operación.)

## 1.4 Qué es Genus OS

**Genus OS** es el sistema que le dice a cada persona del laboratorio **qué tiene que hacer**, **qué hizo** y **qué le queda pendiente** — conectado a las planillas reales de Google Drive, sin obligarla a buscar entidades.

---

# 2. Viaje completo de un pedido

Este capítulo recorre el ciclo de punta a punta: desde que existe demanda comercial hasta la entrega al cliente.

## 2.1 Diagrama macro

```text
Cliente
    ↓
Desarrollo (cuando aplica — muestras, formulación, ajustes)
    ↓
Pedido aprobado
    ↓
Planificación (SEMANAS 2026 + PEDIDOS 2026)
    ↓
Elaboración
    ↓
Orden de Elaboración (ELABORACION/)
    ↓
Lote (ASIGNACION DE LOTES 2026)
    ↓
Acondicionamiento
    ↓
Orden de Acondicionamiento
    ↓
Codificado
    ↓
Calidad
    ↓
Liberación
    ↓
Depósito
    ↓
Entrega
```

## 2.2 Paso a paso

### Paso 0 — Pedido creado

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Comercial / Administración |
| **Planilla** | `PEDIDOS 2026` |
| **Documento generado** | Registro de pedido (cabecera + renglones) |
| **Sector** | COMERCIAL (alta); PRODUCCION y DIRECCION (lectura/seguimiento) |
| **Qué pasa** | Se registra cliente, producto(s), cantidad, fechas, OP/OC, observaciones. Es la **demanda** que el laboratorio debe satisfacer. |

---

### Paso 1 — Entrada en planificación

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Producción (supervisión / planificación) |
| **Planilla** | `SEMANAS 2026` |
| **Documento generado** | Filas de plan semanal (Elaboración, Acondicionamiento, Entregas) |
| **Sector** | PRODUCCION |
| **Qué pasa** | La demanda de `PEDIDOS 2026` se traduce en **trabajo concreto** por día, línea y sector. Aquí nace el **WorkItem** operativo. |

---

### Paso 2 — Elaboración

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Operarios y supervisores de Elaboración |
| **Planilla del trabajo** | `SEMANAS 2026` → bloque **Elaboración** |
| **Planilla del detalle** | Carpeta `ELABORACION/` (un Google Sheet por OE) |
| **Documento generado** | **Orden de Elaboración (OE)** — archivo individual |
| **Sector** | ELABORACION; apoyo MATERIA_PRIMA |
| **Qué pasa** | Se ejecuta la fabricación del **granel**. El operario ve su trabajo del día en Mi Trabajo; abre la OE cuando la acción lo requiere. Consumo de MP (fase posterior con módulo inventario). |

---

### Paso 3 — Lote de granel

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Elaboración (registra producción); Calidad (asigna/seguimiento) |
| **Planilla** | `ASIGNACION DE LOTES 2026` |
| **Documento generado** | Registro de lote (granel) |
| **Sector** | CALIDAD (fuente); ELABORACION (referencia desde OE) |
| **Qué pasa** | El granel producido queda identificado como **lote trazable**, inicialmente en cuarentena hasta liberación. |

---

### Paso 4 — Acondicionamiento

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Operarios de Envasado Masivo o Premium |
| **Planilla del trabajo** | `SEMANAS 2026` → **Acondicionamiento** → línea Masivo o Premium |
| **Documento generado** | **Orden de Acondicionamiento (OA)** |
| **Sector** | ENVASADO_MASIVO **o** ENVASADO_PREMIUM (nunca ambos en la misma vista operativa) |
| **Qué pasa** | El granel **liberado** se envasa en PT. La OA nace desde un WorkItem de acondicionamiento. |

---

### Paso 5 — Codificado

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Operarios de Codificado |
| **Planilla del trabajo** | `SEMANAS 2026` (bloque a confirmar en Discovery) |
| **Documento generado** | Actualización de estado en OA / WorkItem (no entidad GMP separada en MVP) |
| **Sector** | CODIFICADO |
| **Qué pasa** | Etiquetado/codificación verificada. Marca: OK / Pendiente / Bloqueado. |

---

### Paso 6 — Calidad

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Analistas de Calidad |
| **Planilla** | `ASIGNACION DE LOTES 2026` |
| **Documento generado** | Análisis, resultados, observaciones |
| **Sector** | CALIDAD |
| **Qué pasa** | Ensayos sobre granel y/o PT. Evidencia para liberación. Calidad **prepara** disposición; **no firma** liberación legal. |

---

### Paso 7 — Liberación

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Calidad (prepara); Dirección Técnica (firma) |
| **Planilla** | `ASIGNACION DE LOTES 2026` + registro `LIBERACIONES` (modelo GMP) |
| **Documento generado** | **Liberación (RL)** — disposición firmada |
| **Sector** | CALIDAD + DT (firma); DIRECCION (lectura) |
| **Qué pasa** | El lote pasa a estado **Liberado** (o Rechazado/Bloqueado). Solo liberado puede acondicionarse (granel) o despacharse (PT). |

---

### Paso 8 — Depósito

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Depósito |
| **Planilla del trabajo** | `SEMANAS 2026` → **Entregas**; referencia `PEDIDOS 2026` |
| **Documento generado** | Movimiento de despacho (futuro módulo inventario) |
| **Sector** | DEPOSITO |
| **Qué pasa** | PT liberado sale contra renglón de pedido. Cumplimiento del pedido se **deriva** de despachos, no se tipea a mano. |

---

### Paso 9 — Entrega

| Aspecto | Detalle |
|---------|---------|
| **Quién interviene** | Depósito (ejecuta); Comercial (confirma al cliente) |
| **Planilla** | `PEDIDOS 2026` (estado derivado); `SEMANAS 2026` (Entregas) |
| **Documento generado** | Confirmación de entrega / cierre parcial o total del pedido |
| **Sector** | DEPOSITO, COMERCIAL, DIRECCION |
| **Qué pasa** | El ciclo comercial se cierra o avanza (Pendiente → Parcial → Completo). |

---

# 3. Fuente de verdad de cada dato

**Regla:** ningún dato operativo importante puede existir sin fuente oficial declarada. Si Genus OS muestra un dato, debe poder citar esta tabla.

| Dato | Fuente oficial | Quién puede modificarlo | Notas |
|------|----------------|-------------------------|-------|
| Cliente | `PEDIDOS 2026` | Comercial | Maestro comercial futuro: `CLIENTES` |
| Producto (PT/SKU) | `PEDIDOS 2026` | Comercial | Referencia a catálogo `PRODUCTOS` |
| Cantidad pedida | `PEDIDOS 2026` | Comercial | Por renglón de pedido |
| OP / OC | `PEDIDOS 2026` | Comercial | Orden de producción/compra del cliente |
| Fecha compromiso pedido | `PEDIDOS 2026` | Comercial | Clave para prioridad |
| Estado comercial pedido | `PEDIDOS 2026` | Producción / Comercial | Abierto / En proceso / Completo / Cerrado |
| Observaciones pedido | `PEDIDOS 2026` | Comercial | |
| **Trabajo del día** | `SEMANAS 2026` | Producción | Autoridad operativa del período |
| **Trabajo de la semana** | `SEMANAS 2026` | Producción | |
| Día / semana (etiqueta) | `SEMANAS 2026` | — (derivado) | |
| Línea de producción | `SEMANAS 2026` | Producción | Elaboración y Acondicionamiento |
| Kg planificados (elaboración) | `SEMANAS 2026` | Producción | |
| Unidades planificadas (acond.) | `SEMANAS 2026` | Producción | |
| Prioridad operativa | `SEMANAS 2026` | Producción | No inventar en UI |
| Entregas planificadas | `SEMANAS 2026` → Entregas | Producción | |
| **Contenido OE** (fórmula, batch, consumos) | Archivo en `ELABORACION/` | Elaboración | Un archivo ≈ una OE |
| ID OE (negocio) | Sheet dentro de `ELABORACION/` | Elaboración | Puede diferir del nombre de archivo |
| Estado ejecución OE | Sheet `ELABORACION/` | Elaboración | No inferir desde nombre de carpeta |
| **Contenido OA** | Documento OA (Sheet) | Envasado (Masivo/Premium) | Nace desde WorkItem |
| ID OA | Documento OA | Envasado | |
| Cantidad planificada OA | `SEMANAS 2026` + OA | Envasado / Producción | |
| Cantidad real OA | Documento OA | Envasado | |
| Línea Masivo vs Premium | `SEMANAS 2026` | Producción | **Aislamiento estricto** |
| Estado codificado | WorkItem / OA | Codificado | Confirmar columna en Discovery |
| **Lote (ID, producto, marca)** | `ASIGNACION DE LOTES 2026` | Calidad | Fuente principal Calidad |
| Fecha lote / vencimiento | `ASIGNACION DE LOTES 2026` | Calidad | |
| OE ref en lote | `ASIGNACION DE LOTES 2026` | Calidad | |
| OA ref en lote | `ASIGNACION DE LOTES 2026` | Calidad | |
| RL ref | `ASIGNACION DE LOTES 2026` | Calidad / DT | |
| **Resultado análisis** | `ASIGNACION DE LOTES 2026` | Calidad | |
| Observaciones calidad | `ASIGNACION DE LOTES 2026` | Calidad | |
| **Liberación (decisión)** | Registro Liberaciones (GMP) | DT (firma) | Calidad prepara, DT firma |
| Estado lote (disposición) | Derivado de última Liberación | — | Nunca editar a mano |
| Materia prima a preparar | `SEMANAS 2026` (Elaboración) | Materia Prima | Lectura plan + acción MP |
| Stock MP | Módulo inventario (futuro) | Depósito MP | `MOVIMIENTOS` / `SALDOS` |
| Stock PT | Módulo inventario (futuro) | Depósito | |
| Despacho | `MOVIMIENTOS` (futuro) | Depósito | Contra `PEDIDO_DET_ID` |
| Cumplimiento renglón pedido | **Derivado** de despachos | — | No campo manual |
| KPIs dirección | Agregación de fuentes | — | Solo lectura |
| Usuario / sector (futuro) | `sector-access` + Login | Administración | F9–F10 |

**Prohibido:** duplicar fuente (ej. mostrar “responsable = JUNIO” porque la carpeta se llama JUNIO).

---

# 4. Modelo WorkItem

## 4.1 Definición

Un **WorkItem** es la representación software de **una tarea operativa real**: algo que una persona de un sector debe hacer, en una fecha, con trazabilidad a la planilla origen.

Todo lo visible en **Mi Trabajo**, **Plan Semanal** y la búsqueda operativa de **Consulta** debe poder reducirse a WorkItems (las entidades son drill-down).

## 4.2 Campos obligatorios

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Estable: `{source}:{fileId}:{sheet}:{rowRef}` |
| `sector` | SectorId | Sector al que **pertenece el trabajo** (filtro de vista) |
| `ownerSector` | SectorId | Sector **responsable** de ejecutar (puede coincidir con `sector`) |
| `source` | enum | `semanas_2026` \| `pedidos_2026` \| `asignacion_lotes_2026` \| `elaboracion_index` |
| `sourceFileId` | string | ID Google Drive |
| `sourceSheet` | string? | Pestaña / hoja |
| `sourceRange` | string? | Fila/rango origen |
| `originStage` | OriginStage | Etapa del ciclo (ver §4.3) |
| `date` | date? | Fecha operativa |
| `dayLabel` | string? | “Lunes 14/07” |
| `weekLabel` | string? | “Semana 28 · Julio 2026” |
| `client` | string? | |
| `product` | string? | |
| `quantity` | string/number? | |
| `unit` | string? | kg, u, L |
| `line` | string? | Línea física / lógica |
| `deliveryDate` | date? | Compromiso |
| `status` | WorkItemStatus | pendiente \| en_curso \| bloqueado \| completo \| revision \| cancelado |
| `priority` | enum? | `URGENTE` \| `HOY` \| `ESTA_SEMANA` \| `NORMAL` \| `BAJA` — **solo si existe en fuente** |
| `dependsOn` | string[]? | IDs de WorkItems que **deben completarse antes** |
| `blockedBy` | string[]? | IDs de WorkItems que **impiden avanzar** |
| `unblocks` | string[]? | IDs de WorkItems que **este trabajo habilita al completarse** |
| `pedidoRef` | string? | |
| `oeRef` | string? | |
| `oaRef` | string? | |
| `loteRef` | string? | |
| `notes` | string? | |
| `actionLabel` | string | Acción primaria UI |
| `href` | string? | Ruta interna |
| `confidence` | high \| medium \| low | Confianza del mapper |
| `createdFrom` | string | Descripción del origen: “SEMANAS fila 42”, “PEDIDOS renglón 7” |
| `generatedEntities` | string[] | Entidades creadas o vinculadas al completar: `["OE-2026-0142"]`, `["OA-…"]` |

## 4.3 OriginStage (etapa del ciclo)

| Valor | Significado | Fuente típica |
|-------|-------------|---------------|
| `PLANIFICACION` | Trabajo aún en plan / replanificación | SEMANAS, PRODUCCION |
| `ELABORACION` | Fabricación de granel | SEMANAS → Elaboración |
| `ACONDICIONAMIENTO` | Envasado PT | SEMANAS → Acondicionamiento |
| `CODIFICADO` | Etiquetado / codificación | SEMANAS / OA |
| `CALIDAD` | Análisis, cuarentena, disposición | ASIGNACION LOTES |
| `DESPACHO` | Entrega / movimiento | SEMANAS → Entregas, PEDIDOS |

## 4.4 Pipeline obligatorio

```text
Planilla real
    → Discovery (schema confirmado)
    → Mapper → WorkItem[]
    → BFF (filtro sector / fecha / stage)
    → UI (Mi Trabajo / Plan Semanal)
    → Acción → Documento (OE / OA / Análisis / Movimiento)
```

**Prohibido:** `fila de planilla → Card` sin WorkItem intermedio.

## 4.5 Prioridades operativas

Valores canónicos (`WorkItemPriority`):

| Valor | Significado |
|-------|-------------|
| `URGENTE` | Atención inmediata; puede interrumpir plan |
| `HOY` | Debe ejecutarse en el día operativo |
| `ESTA_SEMANA` | Compromiso dentro de la semana en curso |
| `NORMAL` | Prioridad estándar del plan |
| `BAJA` | Puede reprogramarse sin impacto crítico |

**Regla:** si la planilla no trae prioridad explícita, el campo es `null`. No inferir desde fechas ni colores hasta confirmar columnas en Discovery.

## 4.6 Dependencias entre sectores

La cadena operativa principal es:

```text
Elaboración
    ↓ habilita
Envasado (Masivo / Premium)
    ↓ habilita
Codificado
    ↓ habilita
Calidad
    ↓ habilita
Depósito
```

Estas relaciones se materializan en el WorkItem mediante tres campos:

| Campo | Semántica |
|-------|-----------|
| `dependsOn` | WorkItems previos que deben estar completos para **iniciar** este trabajo |
| `blockedBy` | WorkItems activos que **impiden** avanzar (cuarentena, falta MP, lote no liberado, etc.) |
| `unblocks` | WorkItems que **este trabajo habilitará** al completarse |

**F8.1:** los mappers desde SEMANAS dejan `dependsOn`, `blockedBy` y `unblocks` en `null` hasta que Discovery confirme vínculos explícitos o F12 implemente postas automáticas. **No inferir** dependencias solo por la cadena sectorial.

## 4.7 Mappers

| Archivo | Fuente | Estado |
|---------|--------|--------|
| `semanas-to-work-items.ts` | SEMANAS 2026 (todos los bloques) | **F8.1** |
| `semanas-elaboracion-to-work-items.ts` | SEMANAS · Elaboración | F8.2+ (split opcional) |
| `semanas-acondicionamiento-to-work-items.ts` | SEMANAS · Acondicionamiento | F8.2+ |
| `semanas-entregas-to-work-items.ts` | SEMANAS · Entregas | F8.2+ |
| `pedidos-to-work-items.ts` | PEDIDOS 2026 | F8.2+ |
| `lotes-to-work-items.ts` | ASIGNACION DE LOTES 2026 | F8.2+ |

---

# 5. Sectores

Identificadores canónicos (`SectorId`):

`ELABORACION` · `ENVASADO_MASIVO` · `ENVASADO_PREMIUM` · `CODIFICADO` · `MATERIA_PRIMA` · `CALIDAD` · `COMERCIAL` · `DEPOSITO` · `PRODUCCION` · `DIRECCION`

---

## 5.1 Elaboración

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Ejecutar elaboraciones planificadas; producir granel conforme OE. |
| **Qué hace** | Abre OE, registra avance, observaciones, cierra elaboración en documento. |
| **Qué información necesita** | Trabajo hoy/semana (SEMANAS), producto, kg, cliente, ref pedido, ref OE. |
| **Qué NO necesita** | OA de envasado, análisis detallados, KPIs dirección, pedidos comerciales completos. |
| **Qué puede modificar** | Archivo OE en ELABORACION (futuro F11); estado WorkItem elaboración. |
| **Qué documentos genera** | OE (archivo Sheet en ELABORACION/). |
| **WorkItems que consume** | `semanas-elaboracion-to-work-items` |
| **Eventos que genera** | OE creada, OE iniciada, OE cerrada |

**Email futuro:** `elaboracion@laboratoriogenus.com.ar`

---

## 5.2 Envasado Masivo

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Acondicionar PT línea consumo masivo según plan semanal. |
| **Qué hace** | Crea/abre/completa OA, registra unidades, avance, bloqueos. |
| **Qué información necesita** | Plan SEMANAS (solo bloque Masivo), granel liberado, SKU, unidades. |
| **Qué NO necesita** | **Premium**, elaboración detallada, liberaciones DT, dashboard dirección. |
| **Qué puede modificar** | OA de su línea; WorkItems acondicionamiento Masivo. |
| **Qué documentos genera** | OA (sector ENVASADO_MASIVO). |
| **WorkItems que consume** | `semanas-acondicionamiento-to-work-items` (filtro Masivo) |
| **Eventos que genera** | OA creada, OA iniciada, OA cerrada |

**Email futuro:** `emasivo@laboratoriogenus.com.ar`

---

## 5.3 Envasado Premium

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Acondicionar PT línea productos premium. |
| **Qué hace** | Igual que Masivo, scope Premium exclusivo. |
| **Qué información necesita** | SEMANAS · Acondicionamiento · **ENVASADO PRODUCTOS PREMIUM** |
| **Qué NO necesita** | **Masivo**, calidad operativa detallada, producción global. |
| **Qué puede modificar** | OA Premium. |
| **Qué documentos genera** | OA (sector ENVASADO_PREMIUM). |
| **WorkItems que consume** | `semanas-acondicionamiento-to-work-items` (filtro Premium) |
| **Eventos que genera** | OA creada, OA iniciada, OA cerrada |

**Email futuro:** `epremium@laboratoriogenus.com.ar`

---

## 5.4 Codificado

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Verificar y marcar codificación/etiquetado de PT pendientes. |
| **Qué hace** | Marca Codificado OK / Pendiente / Bloqueado. |
| **Qué información necesita** | Lista productos pendientes de codificar (origen SEMANAS — confirmar bloque en Discovery). |
| **Qué NO necesita** | Plan completo, pedidos, análisis microbiológicos. |
| **Qué puede modificar** | Estado codificado en WorkItem/OA. |
| **Qué documentos genera** | Ninguno GMP pesado en MVP; actualización estado. |
| **WorkItems que consume** | SEMANAS (stage CODIFICADO) |
| **Eventos que genera** | — (actualización WorkItem; evento formal en fase posterior) |

**Email futuro:** `codificado@laboratoriogenus.com.ar`

---

## 5.5 Materia Prima

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Preparar MP necesaria para elaboraciones del día. |
| **Qué hace** | Ve qué se elabora hoy, qué MP preparar, reporta faltantes. |
| **Qué información necesita** | Elaboraciones del día (SEMANAS Elaboración), BOM/MP (futuro). |
| **Qué NO necesita** | Acondicionamiento, comercial, dirección. |
| **Qué puede modificar** | Estado preparación MP (WorkItem); movimientos MP (futuro). |
| **Qué documentos genera** | Ninguno en MVP; referencias a lotes MP (futuro). |
| **WorkItems que consume** | Derivados de `semanas-elaboracion` (rol preparación) |
| **Eventos que genera** | — |

**Email futuro:** `materiaprima@laboratoriogenus.com.ar`

---

## 5.6 Calidad

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Analizar, documentar resultados, preparar liberaciones. |
| **Qué hace** | Carga análisis, completa resultados, prepara liberación, bloquea. |
| **Qué información necesita** | ASIGNACION LOTES: lote, producto, marca, OE, OA, RL, observaciones. |
| **Qué NO necesita** | Plan semanal operativo detallado, codificado, comercial. |
| **Qué puede modificar** | ASIGNACION LOTES; análisis; **no firma** liberación legal. |
| **Qué documentos genera** | Análisis; preparación RL (DT firma). |
| **WorkItems que consume** | `lotes-to-work-items` |
| **Eventos que genera** | Análisis creado, Análisis aprobado, (preparación) Lote liberado |

**Email futuro:** `calidad@laboratoriogenus.com.ar`

---

## 5.7 Comercial

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Asegurar cumplimiento de pedidos y comunicación con clientes. |
| **Qué hace** | Crea/edita pedidos, hace seguimiento, escala retrasos. |
| **Qué información necesita** | PEDIDOS 2026 completo; estado derivado; entregas planificadas. |
| **Qué NO necesita** | Detalle OE/OA en planta, análisis, codificado. |
| **Qué puede modificar** | PEDIDOS 2026 (cabecera/renglones comerciales). |
| **Qué documentos genera** | Pedido (alta/modificación). |
| **WorkItems que consume** | `pedidos-to-work-items`, `semanas-entregas` (lectura) |
| **Eventos que genera** | Pedido creado, Pedido modificado, Pedido cancelado |

**Email futuro:** *(a definir — rol comercial existente en RBAC)*

---

## 5.8 Depósito

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Recibir, almacenar y despachar conforme pedido liberado. |
| **Qué hace** | Ejecuta entregas del plan; despacha PT liberado contra pedido. |
| **Qué información necesita** | Entregas (SEMANAS), pedidos listos, saldos (futuro). |
| **Qué NO necesita** | Elaboración, acondicionamiento, análisis. |
| **Qué puede modificar** | Movimientos / despachos (futuro F11). |
| **Qué documentos genera** | Movimiento despacho (futuro). |
| **WorkItems que consume** | `semanas-entregas-to-work-items` |
| **Eventos que genera** | Pedido despachado |

**Email futuro:** *(operario depósito — ver USUARIOS en `03`)*

---

## 5.9 Producción

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Coordinar plan, sectores, prioridades y excepciones. |
| **Qué hace** | Planifica SEMANAS, replanifica, crea OE/OA excepcional, reasigna. |
| **Qué información necesita** | **Todas** las fuentes operativas; vista transversal sectores. |
| **Qué NO necesita** | — (scope amplio; no firma liberaciones DT). |
| **Qué puede modificar** | SEMANAS; puede crear OE/OA manual (auditado). |
| **Qué documentos genera** | Plan; OE/OA excepcionales. |
| **WorkItems que consume** | Agregación de todos los mappers |
| **Eventos que genera** | Plan actualizado; OE/OA creadas (manual); replanificación |

**Email futuro:** `produccion@laboratoriogenus.com.ar`

---

## 5.10 Dirección

| Dimensión | Contenido |
|-----------|-----------|
| **Misión** | Visión ejecutiva, KPIs, excepciones estratégicas. |
| **Qué hace** | Monitorea; profundiza alertas; no opera planta. |
| **Qué información necesita** | Agregados: producción, pedidos, entregas, indicadores. |
| **Qué NO necesita** | Detalle operativo de una fila de envasado. |
| **Qué puede modificar** | Lectura global; acciones estratégicas (futuro). |
| **Qué documentos genera** | Ninguno operativo en planta. |
| **WorkItems que consume** | KPIs / alertas (derivados) |
| **Eventos que genera** | — (consumidor principal) |

**Email futuro:** `direccion@laboratoriogenus.com.ar`

---

# 5A. Producción como orquestador

**Producción deja de ser un sector común.** Es el **orquestador operativo** del laboratorio: coordina el plan, los sectores, las prioridades y las excepciones. No ejecuta elaboración ni envasado; **dirige** quién hace qué y cuándo.

## 5A.1 Capacidades del orquestador

| Capacidad | Descripción |
|-----------|-------------|
| **Replanificar** | Modificar SEMANAS 2026 (fechas, volúmenes, asignaciones) |
| **Mover trabajos** | Reasignar WorkItems entre días, líneas o sectores |
| **Cambiar prioridades** | URGENTE / HOY / ESTA_SEMANA / NORMAL / BAJA |
| **Crear OE** | Alta excepcional de Orden de Elaboración |
| **Crear OA** | Alta excepcional de Orden de Acondicionamiento |
| **Reasignar líneas** | Masivo ↔ Premium solo con reglas de aislamiento |
| **Visualizar carga** | Vista transversal de capacidad vs. carga por sector |
| **Aprobar cambios** | Validar excepciones que afectan compromisos comerciales |

## 5A.2 Modelo `ProductionOverview` (F8.1)

Agregación para la consola de Producción (UI en fase posterior):

| Campo | Contenido |
|-------|-----------|
| `capacity` | Capacidad planificada por sector |
| `load` | Carga actual (WorkItems activos) |
| `blockers` | Trabajos bloqueados con motivo |
| `sectors` | Sectores con actividad |
| `priorities` | Distribución por prioridad |
| `dependencies` | Grafo `dependsOn` / `blockedBy` / `unblocks` |

**F8.1:** modelo tipado en código; sin pantalla dedicada todavía.

## 5A.3 Relación con otros sectores

- **Lee** todas las fuentes operativas (SEMANAS, PEDIDOS, LOTES, índices OE/OA).
- **Escribe** SEMANAS y creación excepcional de OE/OA (F11).
- **No firma** liberaciones legales (rol DT).
- **Mi Trabajo** de Producción muestra panorama global, no filas de envasado individuales.

---

# 6. Dashboard por sector

**Regla:** cada sector tiene **su propia Home**. No es el mismo layout con filtros distintos. Es una **experiencia diseñada para esa misión**.

Hasta F9 (Login), un **selector manual de sector** simula la identidad.

---

## 6.1 Elaboración — Mi Trabajo

```text
Hola Elaboración

├── Para hacer hoy
├── Esta semana
├── Mis OE (abiertas)
├── En curso
├── Pendientes
└── Bloqueadas

Acción destacada: [ Crear OE ]  (si Producción delegó o excepción)
```

---

## 6.2 Envasado Masivo — Mi Trabajo

```text
Hola Envasado Masivo

├── Para hacer hoy
├── Esta semana
├── Mis OA
├── Pendientes
├── Bloqueadas
└── [ Crear OA ]
```

---

## 6.3 Envasado Premium — Mi Trabajo

```text
Hola Envasado Premium

├── Para hacer hoy
├── Esta semana
├── Mis OA
├── Pendientes
├── Bloqueadas
└── [ Crear OA ]
```

*(Misma estructura que Masivo; datos **exclusivamente** Premium.)*

---

## 6.4 Codificado — Mi Trabajo

```text
Hola Codificado

├── Para codificar hoy
├── Pendientes
├── Bloqueados
└── Completados hoy
```

---

## 6.5 Materia Prima — Mi Trabajo

```text
Hola Materia Prima

├── Elaboraciones de hoy
├── MP a preparar
├── Faltantes
└── Preparado ✓
```

---

## 6.6 Calidad — Mi Trabajo

```text
Hola Calidad

├── Análisis pendientes
├── Liberaciones (preparar)
├── Lotes bloqueados
├── Resultados del día
└── En revisión DT
```

---

## 6.7 Comercial — Mi Trabajo

```text
Hola Comercial

├── Pedidos en riesgo
├── Compromisos esta semana
├── En producción (resumen)
├── Listos para despachar
└── [ Crear pedido ]
```

---

## 6.8 Depósito — Mi Trabajo

```text
Hola Depósito

├── Entregas hoy
├── Despachos pendientes
├── Recepciones
└── Bloqueos de stock
```

---

## 6.9 Producción — Mi Trabajo

```text
Hola Producción

├── Plan semanal (vista global)
├── Por sector (resumen)
├── Replanificaciones
├── Problemas
├── Prioridades
└── KPIs operativos
```

---

## 6.10 Dirección — Mi Trabajo

```text
Hola Dirección

├── Producción (panorama)
├── Pedidos
├── Entregas
├── KPIs
├── Alertas
└── Indicadores
```

---

# 7. Acciones permitidas por sector

Leyenda: **Puede** = acción futura habilitada por RBAC + escritura Sheets (F11). **No puede** = segregación GMP o scope sector.

---

## 7.1 Elaboración

| Puede | No puede |
|-------|----------|
| Crear OE | Liberar lote |
| Editar OE | Crear OA |
| Cerrar OE | Firmar liberación |
| Marcar avance WorkItem | Modificar PEDIDOS comerciales |
| Registrar observaciones | Replanificar SEMANAS global |

---

## 7.2 Envasado (Masivo y Premium)

| Puede | No puede |
|-------|----------|
| Crear OA | Liberar lote |
| Editar OA | Cerrar OE |
| Completar OA | Ver línea del otro envasado |
| Registrar unidades / avance | Firmar RL |
| Registrar observaciones | |
| Marcar bloqueos | |

---

## 7.3 Codificado

| Puede | No puede |
|-------|----------|
| Marcar Codificado OK | Crear OE/OA |
| Marcar Pendiente | Liberar |
| Marcar Bloqueado | Editar pedidos |

---

## 7.4 Materia Prima

| Puede | No puede |
|-------|----------|
| Marcar MP preparada | Liberar |
| Reportar faltante | Cerrar OE/OA |
| Ver elaboraciones del día | Despachar |

---

## 7.5 Calidad

| Puede | No puede |
|-------|----------|
| Crear análisis | Firmar liberación legal (DT) |
| Editar análisis | Cerrar OE/OA en planta |
| Completar resultados | Despachar |
| Preparar liberación | |
| Bloquear lote | |

---

## 7.6 Comercial

| Puede | No puede |
|-------|----------|
| Crear / editar pedido | Operar OE/OA |
| Cancelar pedido (reglas) | Liberar |
| Seguimiento | Modificar SEMANAS |

---

## 7.7 Depósito

| Puede | No puede |
|-------|----------|
| Despachar (futuro) | Liberar |
| Recepcionar (futuro) | Crear OE/OA |
| Ver entregas planificadas | Editar análisis |

---

## 7.8 Producción

| Puede | No puede |
|-------|----------|
| Crear OE | Firmar liberación DT |
| Crear OA | — |
| Replanificar SEMANAS | |
| Cambiar prioridades | |
| Reasignar líneas | |
| Ver todos los sectores operativos | |

---

## 7.9 Dirección

| Puede | No puede |
|-------|----------|
| Ver todo (lectura) | Operar planta directamente |
| Profundizar excepciones | Firmar en nombre de DT *(salvo que sea DT)* |
| Acceder KPIs y alertas | Crear OE/OA rutinarias |

---

# 8. Eventos del sistema

Los eventos son hechos auditables que conectan sectores. En fases futuras materializan postas automáticas (F12).

| Evento | Quién lo genera | Sector | Efecto típico |
|--------|-----------------|--------|---------------|
| **Pedido creado** | Comercial | COMERCIAL | WorkItems de seguimiento; visible Producción/Dirección |
| **Pedido modificado** | Comercial / Producción | COMERCIAL | Actualiza refs en planificación |
| **Pedido cancelado** | Comercial | COMERCIAL | Cancela WorkItems derivados |
| **Plan actualizado** | Producción | PRODUCCION | Regenera WorkItems desde SEMANAS |
| **OE creada** | Elaboración / Producción | ELABORACION | Archivo ELABORACION/; link en WorkItem |
| **OE iniciada** | Elaboración | ELABORACION | WorkItem → en_curso |
| **OE cerrada** | Elaboración | ELABORACION | Granel → cuarentena; evento Calidad |
| **OA creada** | Envasado / Producción | ENVASADO_* | Documento OA; link WorkItem |
| **OA iniciada** | Envasado | ENVASADO_* | WorkItem → en_curso |
| **OA cerrada** | Envasado | ENVASADO_* | PT → cuarentena; evento Calidad / Codificado |
| **Análisis creado** | Calidad | CALIDAD | Registro en ASIGNACION LOTES |
| **Análisis aprobado** | Calidad | CALIDAD | Habilita preparación RL |
| **Lote liberado** | DT (firma) | CALIDAD → DT | Estado lote Liberado; habilita OA o despacho |
| **Pedido despachado** | Depósito | DEPOSITO | Movimiento; cumplimiento pedido derivado |

**Regla:** un evento nunca se inventa en UI. Debe corresponder a un cambio real en fuente oficial o a una acción explícita del usuario con permiso.

## 8.1 Eventos automáticos entre sectores (F12 — solo documentar)

Estos flujos **no se implementan en F8.1**. Definen el contrato de postas automáticas para F12:

```text
OE cerrada
    ↓
crear WorkItem
Envasado (Acondicionamiento)
```

```text
OA completada
    ↓
crear WorkItem
Codificado
```

```text
Codificado OK
    ↓
crear WorkItem
Calidad
```

```text
Lote liberado
    ↓
habilitar despacho (Depósito)
```

Cada posta debe:

1. Crear WorkItem(s) con `createdFrom` trazable al evento origen.
2. Poblar `dependsOn` / `unblocks` según §4.6.
3. Respetar segregación GMP (quien cierra OE no crea OA en nombre de Envasado sin permiso).

---

# 9. Navegación definitiva

## 9.1 Fin de los Workspaces como centro

Los **Workspaces** entity-centric (Bandeja genérica, cards de OE sueltas, “estás al día” vacío) **dejan de ser el centro del sistema**.

Quedan deprecados como modelo de navegación principal. La experiencia F8+ se organiza así:

## 9.2 Menú global (conceptual)

```text
Mi Trabajo          ← Home del sector (default al entrar)
Plan Semanal        ← Vista SEMANAS 2026
Pedidos             ← COMERCIAL, PRODUCCION, DIRECCION
Lotes / Calidad     ← CALIDAD (+ lectura PRODUCCION/DIRECCION)
Consulta            ← Búsqueda transversal (scope por sector)
Dirección           ← Solo DIRECCION / PRODUCCION (KPIs)
```

## 9.3 Visibilidad por sector

| Pantalla | ELAB | MAS | PRE | COD | MP | CAL | COM | DEP | PROD | DIR |
|----------|:----:|:---:|:---:|:---:|:--:|:---:|:---:|:---:|:----:|:---:|
| Mi Trabajo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Plan Semanal | ○ | ○ | ○ | — | ○ | ○ | ○ | ○ | ✓ | ✓ |
| Pedidos | — | — | — | — | — | ○ | ✓ | ○ | ✓ | ✓ |
| Lotes/Calidad | — | — | — | — | — | ✓ | — | — | ✓ | ✓ |
| Consulta | ✓* | ✓* | ✓* | ✓* | ✓* | ✓* | ✓* | ✓* | ✓ | ✓ |
| Dirección (KPIs) | — | — | — | — | — | — | ○ | — | ✓ | ✓ |

✓ = acceso completo · ○ = lectura/resumen · ✓* = scope filtrado · — = no visible

## 9.4 Rutas URL (objetivo)

| Ruta | Propósito |
|------|-----------|
| `/mi-trabajo` | Home sectorial |
| `/plan-semanal` | SEMANAS 2026 |
| `/pedidos` | PEDIDOS 2026 |
| `/lotes` o `/calidad` | ASIGNACION LOTES |
| `/consulta` | Búsqueda |
| `/direccion` | Dashboard ejecutivo |

Detalle documental bajo demanda: `/oe/[id]`, `/oa/[id]` — **no** como home.

---

# 10. Modelo RBAC futuro (sin implementar)

## 10.1 Cadena de acceso

```text
email
    ↓
sector (único)
    ↓
roles (GMP — ver 04-rbac.md)
    ↓
permisos (módulo × acción)
    ↓
acciones (sobre WorkItem / entidad)
    ↓
pantallas visibles
```

## 10.2 Regla F8.0

- **Un email → un sector operativo** (excepción: Producción/Dirección con scope amplio).
- El sector determina **pantallas**, no solo filtros.

## 10.2.1 Selector temporal `CurrentSector` (F8.1 — pre-login)

Hasta F9, la identidad de sector se simula con configuración en cliente:

| Valor | Sector |
|-------|--------|
| `ELABORACION` | Elaboración |
| `ENVASADO_MASIVO` | Envasado Masivo |
| `ENVASADO_PREMIUM` | Envasado Premium |
| `CODIFICADO` | Codificado |
| `MATERIA_PRIMA` | Materia Prima |
| `CALIDAD` | Calidad |
| `PRODUCCION` | Producción (orquestador) |
| `DIRECCION` | Dirección |

Persistencia: `localStorage` (`genus-current-sector`). **No es UI definitiva** — sustituida por email → sector en F10.

## 10.3 Matriz email → sector → pantallas

### elaboracion@laboratoriogenus.com.ar → ELABORACION

```text
Ve:     Mi Trabajo · Plan Semanal (lectura) · Consulta (OE, elaboración)
No ve:  Pedidos · Lotes/Calidad · Dirección · OA envasado · Producción global
```

### emasivo@laboratoriogenus.com.ar → ENVASADO_MASIVO

```text
Ve:     Mi Trabajo · Consulta (OA, acond. masivo)
No ve:  Premium · Producción · Dirección · Calidad · Pedidos
```

### epremium@laboratoriogenus.com.ar → ENVASADO_PREMIUM

```text
Ve:     Mi Trabajo · Consulta (OA, premium)
No ve:  Masivo · Producción · Dirección · Calidad
```

### codificado@laboratoriogenus.com.ar → CODIFICADO

```text
Ve:     Mi Trabajo · Consulta (codificado)
No ve:  Elaboración · Envasado · Calidad · Dirección
```

### materiaprima@laboratoriogenus.com.ar → MATERIA_PRIMA

```text
Ve:     Mi Trabajo · Consulta (MP, elaboraciones hoy)
No ve:  Envasado · Calidad · Dirección · Pedidos
```

### calidad@laboratoriogenus.com.ar → CALIDAD

```text
Ve:     Mi Trabajo · Lotes/Calidad · Consulta (lotes, análisis)
No ve:  Plan Semanal operativo · Envasado · Comercial · Dirección KPIs
```

### produccion@laboratoriogenus.com.ar → PRODUCCION

```text
Ve:     Mi Trabajo · Plan Semanal · Pedidos · Lotes/Calidad · Consulta · Dirección (operativo)
No ve:  — (scope transversal; no firma DT)
```

### direccion@laboratoriogenus.com.ar → DIRECCION

```text
Ve:     Mi Trabajo (KPIs) · Plan Semanal · Pedidos · Lotes/Calidad · Consulta · Dirección
No ve:  Acciones operativas de planta (solo lectura / excepciones)
```

### Comercial y Depósito

Definir email definitivo antes de F9; pantallas según §9.3.

## 10.4 Archivo de configuración (futuro)

`sector-access.ts` — especificación en código **después** de aprobar este documento. No implementar en F8.0.

---

# 11. Qué NO hacer

Este capítulo es **obligatorio** para todo desarrollador y agente de código.

## 11.1 Datos

- **No inventar** estados, responsables, progreso %, prioridades ni fechas.
- **No usar mocks** en modo real (`GENUS_DATA_MODE=real`).
- **No asumir** columnas, headers ni nombres de pestaña sin Discovery.
- **No duplicar** fuentes de verdad (un dato = una autoridad).
- **No mostrar “0”** sin explicación diagnóstica (usar panel Discovery).

## 11.2 Producto / UI

- **No parchear** Workspaces entity-centric actuales como solución permanente.
- **No mapear** planilla → Card sin WorkItem.
- **No usar** la misma Home para todos los sectores con filtros.
- **No mezclar** Envasado Masivo y Premium en una vista.
- **No mostrar** “estás al día” cuando faltan fuentes o mappers.

## 11.3 Implementación (F8.1)

- **Sí implementar** infraestructura operativa: Discovery SEMANAS, mappers → WorkItem, `/mi-trabajo`, selector temporal de sector, modelo `ProductionOverview`.
- **No implementar** Login, OAuth, RBAC enforcement, escritura Sheets.
- **No eliminar** pantallas E1–E7 ni romper modo Demo.
- **No optimizar** UI legacy (Workspaces entity-centric); conviven hasta F8.3+.
- **No volver** al modelo centrado en entidades como home del sistema.

---

# 12. Roadmap post-aprobación

Constitución **aprobada**. Orden de implementación:

```text
F8.1   Discovery SEMANAS + WorkItems + /mi-trabajo  ← en curso
           ↓
F8.2   Mappers → WorkItem (PEDIDOS, LOTES, splits SEMANAS)
           ↓
F8.3   Mi Trabajo (Home por sector)
           ↓
F8.4   Plan Semanal
           ↓
F8.5   Pedidos
           ↓
F8.6   Lotes / Calidad
           ↓
F9     Login (Google OAuth)
           ↓
F10    RBAC (email → sector → pantallas)
           ↓
F11    Escritura en Drive / Sheets
           ↓
F12    Automatizaciones (postas entre sectores)
           ↓
F13    Notificaciones (Slack / in-app)
```

**Dependencia crítica:** F8.1 requiere E7.2 Discovery base + extensión específica SEMANAS (tabs, bloques Elaboración/Acondicionamiento/Entregas, headers por sector).

---

# Anexo A — Relación con documentación existente

| Documento | Estado respecto a F8.0 |
|-----------|------------------------|
| `21-modelo-operativo-genus.md` | **Supersedido** por este documento |
| `08-workspaces.md` | Deprecado como navegación central; conservar gramática visual |
| `05-flujos-operativos.md` | Vigente para entidades GMP |
| `03-modelo-de-datos.md` | Vigente para entidades; WorkItem es capa operativa encima |
| `04-rbac.md` | Vigente para permisos GMP; complementado por §10 |
| E7.2 Discovery | Prerequisito técnico inmediato |

---

# Anexo B — Criterios de aceptación F8.1

| Criterio | Referencia |
|----------|------------|
| Documento 22 con Desarrollo, Producción orquestador, deps, prioridades, eventos auto | §2, §4.5–§4.6, §5A, §8.1 |
| `GET /api/v1/discovery/semanas` operativo | E7.2 + F8.1 |
| Mapper `semanas-to-work-items.ts` → `WorkItem[]` sin Cards | §4.7 |
| Campos ausentes = `null` (no inventar) | §11.1 |
| `/mi-trabajo` consume solo WorkItems reales | §6, §9 |
| Selector temporal `CurrentSector` | §10 (pre-login) |
| Modelo `ProductionOverview` tipado | §5A.2 |
| E1–E7, Demo, Drive, Discovery intactos | §11.3 |
| `npm run lint` y `npm run build` OK | — |

---

*Constitución operativa de Genus OS — F8.0 aprobada — F8.1 motor operativo.*
