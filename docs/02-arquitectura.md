# 02 — Arquitectura

Arquitectura conceptual y de datos del sistema. El detalle campo por campo está en `03-modelo-de-datos.md`; este documento explica **cómo encaja todo, cómo se mueven las entidades y cómo interactúan**.

---

## 1. Principios arquitectónicos (no negociables)

Estos principios son la base de la integridad GMP del sistema. **No deben romperse bajo ninguna circunstancia.**

### 1.1 El inventario es un libro mayor append-only

`MOVIMIENTOS` es la **única fuente de verdad** del stock. Nunca se edita ni se borra un movimiento. Toda corrección es un movimiento nuevo (ajuste positivo o contramovimiento negativo). Esto garantiza trazabilidad completa y auditabilidad ALCOA.

### 1.2 Los saldos son una caché derivada

`SALDOS` se calcula como la suma de `MOVIMIENTOS.cantidad_signo` por lote. **Nunca se edita a mano.** Si el saldo no coincide con la realidad física, se registra un ajuste en `MOVIMIENTOS`, no se corrige `SALDOS`.

### 1.3 Los estados se derivan, no se tipean

El estado de un lote, de una orden, de un renglón de pedido, se **determina por eventos del sistema**, no por un campo que alguien escribe libremente.

| Entidad | Cómo se deriva el estado |
|---|---|
| Lote | Última fila de `LIBERACIONES` para ese `LOTE_ID` |
| Renglón de pedido | Suma de despachos vs. cantidad pedida |
| OE / OA | Transiciones de flujo (Planificada → En curso → Cerrada) |

Esto elimina el error humano y garantiza auditabilidad.

### 1.4 La fórmula vive en el BOM, versionada

La receta no vive en la OE ni en la OA. Vive en `BOM` (Bill of Materials), con versionado. Cuando una OE u OA nace, **congela** la versión de BOM que usó (`bom_version`). Cambiar el BOM no altera órdenes pasadas.

### 1.5 Dos barreras de liberación humanas

1. **Granel:** debe liberarse (firma DT) antes de poder acondicionarse.
2. **PT:** debe liberarse (firma DT) antes de poder despacharse.

Ambas son decisiones humanas firmadas, registradas de forma inmutable en `LIBERACIONES`.

### 1.6 Trazabilidad por lote

Todo ítem (MP, ME, Granel, PT) se mueve por lote. La cadena completa es reconstruible:

```
PT despachado
  → LOTE(PT) producido en OA
    → OA_MATERIALES (ME consumidos por lote)
    → Granel consumido (de LOTE Granel liberado)
      → LOTE(Granel) producido en OE
        → OE_CONSUMO (MP consumidas por lote)
          → LOTE(MP) recibido y liberado
```

### 1.7 Segregación de funciones

Quien ejecuta/cierra una orden **no puede** ser quien firma su liberación. Esto se implementa en RBAC (`04-rbac.md`) y en reglas operativas (firmante ≠ cerrador).

---

## 2. Entidades del sistema

Agrupadas por dominio. El diccionario completo campo por campo está en `03-modelo-de-datos.md`.

### Dominio Comercial

| Entidad | Propósito |
|---|---|
| `CLIENTES` | Marcas/empresas para las que se fabrica |
| `PEDIDOS` | Cabecera de pedido del cliente |
| `PEDIDOS_DET` | Renglones de producto pedido |
| `PRODUCTOS` | Catálogo de PT/SKU |

### Dominio Planificación / Producción

| Entidad | Propósito |
|---|---|
| `PLANIFICACION` | Programa de producción |
| `OE` | Orden de Elaboración (produce granel) |
| `OE_CONSUMO` | Consumos de MP por lote en una OE |
| `OA` | Orden de Acondicionamiento (produce PT) |
| `OA_MATERIALES` | Consumos de ME por lote en una OA |
| `BOM` | Fórmulas/recetas versionadas (elaboración + acondicionamiento) |

### Dominio Inventario

| Entidad | Propósito |
|---|---|
| `MATERIAS_PRIMAS` | Maestro de MP |
| `MATERIALES_EMPAQUE` | Maestro de ME |
| `LOTES` | Instancia trazable de cualquier ítem |
| `MOVIMIENTOS` | Libro mayor append-only |
| `SALDOS` | Caché derivada de existencias |

### Dominio Calidad

| Entidad | Propósito |
|---|---|
| `ANALISIS_CALIDAD` | Evidencia de ensayos/controles |
| `LIBERACIONES` | Disposición firmada sobre un lote (append-only) |

### Dominio Gobierno (RBAC)

| Entidad | Propósito |
|---|---|
| `USUARIOS` | Identidad y rol de cada persona |
| `ROLES` | Catálogo de roles |
| `MODULOS` | Unidades funcionales protegibles |
| `PERMISOS` | Matriz rol × módulo × acción |

### Dominio Sistema

| Entidad | Propósito |
|---|---|
| `PARAMETROS` | Listas de valores (estados, unidades, tipos de movimiento, etc.) |

### Entidades futuras (propuestas)

| Entidad | Propósito | Estado |
|---|---|---|
| `TAREAS` | Cola unificada de trabajo | Propuesta |
| `INCIDENCIAS` | Reporte de problemas en planta | Propuesta |
| `DOCUMENTOS` | POEs y gestión documental | Propuesta |
| `CAPACITACIONES` | Registro de formación del personal | Propuesta |

---

## 3. Relaciones clave

### Cadena comercial

```
CLIENTE (1) ──→ (N) PEDIDOS (1) ──→ (N) PEDIDOS_DET (N) ──→ (1) PRODUCTOS
```

### Cadena de producción

```
PLANIFICACION ──→ OE ──→ LOTE(Granel) ──→ OA ──→ LOTE(PT)
                    │                        │
                    └── OE_CONSUMO(MP)       └── OA_MATERIALES(ME)
```

### Cadena de inventario

```
LOTES (1) ──→ (N) MOVIMIENTOS
LOTES (1) ──→ (1) SALDOS (derivado)
```

### Cadena de calidad

```
LOTES (1) ──→ (N) ANALISIS_CALIDAD
LOTES (1) ──→ (N) LIBERACIONES (append-only; la última determina el estado)
```

### Cadena de fórmula

```
PRODUCTOS (1) ──→ (N) BOM (versionado)
BOM_ELABORACION: BOM (1) ──→ (N) MP
BOM_ACONDICIONAMIENTO: BOM (1) ──→ (N) ME
```

### RBAC

```
USUARIOS.ROL_ID ──→ ROLES
PERMISOS: (ROL_ID, MODULO_ID, accion) ──→ permitido TRUE/FALSE
```

### Cardinalidades críticas

| Relación | Cardinalidad | Nota |
|---|---|---|
| OE → Granel | 1:1 | Una OE produce un granel |
| Granel → OA | 1:N | Un granel puede alimentar muchas OA/SKU |
| OA → PT | 1:1 | Una OA produce un PT |
| OE → OE_CONSUMO | 1:N | Una MP del BOM = una fila de consumo |
| OA → OA_MATERIALES | 1:N | Un ME del BOM = una fila con su lote |

---

## 4. Cómo se mueve la información

### 4.1 Cómo se mueve un lote

```
1. NACE
   Por recepción (MP/ME) o por producción (Granel en OE; PT en OA).
   → Crea fila en LOTES (estado inicial Cuarentena para granel/PT)
   → Crea MOVIMIENTOS de entrada (Recepción o Producción, signo +)

2. SE ANALIZA
   Calidad carga ANALISIS_CALIDAD con ensayos y resultados.

3. SE DISPONE
   Se registra fila en LIBERACIONES (decisión: Liberado/Rechazado/Condicional/Bloqueado).
   Firmada por Dirección Técnica.
   → LOTES.estado pasa a reflejar esa decisión.

4. SE CONSUME O SE DESPACHA
   Cada consumo (en OE/OA) o despacho genera MOVIMIENTOS de salida (signo −).
   → Baja SALDOS del lote.

5. EVENTOS POSTERIORES
   Un lote liberado puede bloquearse luego (recall).
   → Nueva fila en LIBERACIONES. El historial queda intacto.
```

**Regla crítica:** liberar un lote **no mueve stock**. La liberación es una disposición de calidad, no un movimiento de inventario.

### 4.2 Cómo se mueve un pedido

```
1. COMERCIAL crea PEDIDO (cliente) + PEDIDOS_DET (renglones de PT con cantidad).

2. SUPERVISOR planifica (PLANIFICACION) y genera las OE/OA necesarias.

3. A MEDIDA QUE se produce, libera y despacha:
   El cumplimiento de cada renglón se DERIVA de los MOVIMIENTOS de tipo Despacho
   imputados a ese PEDIDO_DET_ID:
   
   despachado = Σ cantidades despachadas del renglón
   estado = Pendiente (despachado=0) | Parcial (0 < despachado < pedida) | Completo (despachado ≥ pedida)
```

**Regla crítica:** no hay campo manual de cumplimiento. Se calcula.

### 4.3 Cómo se mueve una OE

```
1. NACE desde planificación
   Estado: Planificada
   Congela bom_version del BOM vigente

2. INICIAR
   Estado: En curso

3. CONSUMIR MP
   Cada MP del BOM se registra en OE_CONSUMO (lote + cantidad real)
   → Genera MOVIMIENTOS de Consumo (−) por cada consumo
   Validaciones: lote liberado, no vencido, cantidad ≤ saldo, ítem correcto

4. CONTROLES DE PROCESO
   Se registran según especificación (pH, aspecto, etc.)

5. REGISTRAR LOTE DE GRANEL
   → Crea LOTE(Granel) en Cuarentena
   → MOVIMIENTOS de Producción (+)

6. CIERRE (Supervisor)
   Estado: Cerrada (inmutable)
   → Granel pasa a cola de calidad

7. LIBERACIÓN DEL GRANEL
   Calidad analiza → DT firma
   → Solo granel Liberado puede acondicionarse
```

### 4.4 Cómo se mueve una OA

```
1. NACE ligada a PT/SKU y granel LIBERADO
   Estado: Planificada
   Congela BOM_ACONDICIONAMIENTO

2. INICIAR
   Estado: En curso

3. CONSUMIR ME POR LOTE
   Cada ME se registra en OA_MATERIALES con su LOTE_ID
   → Genera MOVIMIENTOS de Consumo (−) de ME
   → Genera MOVIMIENTOS de Consumo (−) del granel
   Validaciones: lote ME liberado, no vencido, cantidad ≤ saldo

4. CONTROLES DE ENVASADO
   Inicio/medio/final, codificado, etiquetado, rendimiento

5. REGISTRAR LOTE DE PT
   → Crea LOTE(PT) en Cuarentena
   → MOVIMIENTOS de Producción (+)

6. CIERRE (Supervisor)
   Estado: Cerrada

7. LIBERACIÓN DEL PT
   Calidad analiza → DT firma
   → Solo PT Liberado puede despacharse
```

### 4.5 Cómo interactúan (visión integrada)

El flujo es una **cadena de eventos** donde el estado de salida de un paso es la condición de entrada del siguiente. Cada transición habilita una tarea para el rol responsable (la "posta").

```
Evento                    →  Condición habilitada       →  Tarea para rol
─────────────────────────────────────────────────────────────────────────
OE lista                  →  Supervisor puede cerrar   →  "Cerrar OE"
OE cerrada                →  Granel en cuarentena      →  "Analizar" (Calidad)
Granel liberado           →  Puede crear OA            →  "Acondicionar" (Prod.)
OA cerrada                →  PT en cuarentena          →  "Analizar" (Calidad)
PT liberado               →  Puede despachar           →  "Despachar" (Depósito)
Despacho registrado       →  Cumplimiento actualizado  →  "Seguir pedido" (Comercial)
```

El inventario refleja cada evento como movimiento. Los saldos se recalculan. Las barreras de calidad detienen el flujo hasta la firma.

---

## 5. Diagrama conceptual de flujo completo

```
CLIENTE
   │
   ▼
PEDIDO ──────────────────────────────────────────────────────────────┐
   │                                                                  │
   ▼                                                                  │
PEDIDOS_DET (renglón: PRODUCTO + cantidad)                           │
   │                                                                  │
   ▼                                                                  │
PLANIFICACION                                                         │
   │                                                                  │
   ├──────────────────────┐                                          │
   ▼                      ▼                                          │
  OE                     OA (requiere granel liberado)                │
   │                      │                                          │
   │ consume MP           │ consume ME + granel                      │
   ▼                      ▼                                          │
OE_CONSUMO            OA_MATERIALES                                   │
   │                      │                                          │
   ▼                      ▼                                          │
MOVIMIENTOS(−)        MOVIMIENTOS(−)                                 │
   │                      │                                          │
   ▼                      ▼                                          │
LOTE Granel            LOTE PT                                        │
(Cuarentena)           (Cuarentena)                                   │
   │                      │                                          │
   ▼                      ▼                                          │
ANALISIS_CALIDAD       ANALISIS_CALIDAD                              │
   │                      │                                          │
   ▼                      ▼                                          │
LIBERACIONES(firma DT) LIBERACIONES(firma DT)                        │
   │                      │                                          │
   ▼                      ▼                                          │
LOTE Granel            LOTE PT                                        │
(Liberado)             (Liberado)                                     │
   │                      │                                          │
   └──── alimenta OA ──────┘                                          │
                           │                                          │
                           ▼                                          │
                    DESPACHO (MOVIMIENTOS Despacho −)                 │
                           │                                          │
                           ▼                                          │
                    Cumplimiento del renglón (derivado) ◄─────────────┘
```

---

## 6. Arquitectura de capas

### Capa actual (producción)

```
┌─────────────────────────────────────────┐
│           AppSheet (UI + lógica)        │
│  Vistas · Formularios · Acciones · RBAC │
│  Automatizaciones (bots)                │
├─────────────────────────────────────────┤
│         Google Sheets (datos)           │
│  Tablas · Fórmulas · Validaciones       │
├─────────────────────────────────────────┤
│    Apps Script · Looker · Slack         │
│    Automatización · Reportería · Avisos │
└─────────────────────────────────────────┘
```

### Capa futura (visión)

```
┌─────────────────────────────────────────┐
│     Front-end propio (React/Next.js)    │
│  Workspaces · Bandeja · Design System   │
├─────────────────────────────────────────┤
│           Capa de API (servicio)        │
│  Auth · RBAC · Validación · Contratos   │
├─────────────────────────────────────────┤
│     Backend actual (sin cambios)        │
│  Google Sheets · AppSheet · Bots        │
├─────────────────────────────────────────┤
│              Servicios IA               │
│  Creamy (RAG) · Notificaciones          │
└─────────────────────────────────────────┘
```

El front-end propio es **otra interfaz** sobre el mismo backend. No reemplaza la lógica.

---

## 7. Dependencias entre componentes

| Componente | Depende de | Notas |
|---|---|---|
| OE | BOM vigente, PLANIFICACION | Congela bom_version |
| OA | Granel liberado, BOM acondicionamiento | No puede crearse sin granel liberado |
| OE_CONSUMO | LOTE(MP) liberado, SALDOS | Validaciones error-proofing |
| OA_MATERIALES | LOTE(ME) liberado, SALDOS | Resuelve hueco GMP histórico |
| LIBERACIONES | ANALISIS_CALIDAD | Evidencia previa a disposición |
| Despacho | LOTE(PT) liberado, PEDIDOS_DET | Sin entidad "Orden de Despacho" |
| SALDOS | MOVIMIENTOS | Siempre derivado |
| Cumplimiento pedido | MOVIMIENTOS (Despacho) | Siempre derivado |
| TAREAS (futuro) | Estados de todas las entidades | Automatizaciones de la posta |
| Creamy (futuro) | Procedimientos (RAG), RBAC | No escribe; solo orienta |

---

## 8. Reglas de integridad transversales

1. **Append-only:** `MOVIMIENTOS` y `LIBERACIONES`. Jamás UPDATE ni DELETE.
2. **Derivado:** `SALDOS` y cumplimientos de `PEDIDOS_DET`. Jamás escritura manual.
3. **Estados derivados:** `LOTES.estado` = última `LIBERACIONES`. Estados de orden por transición.
4. **Congelado:** `bom_version` en OE/OA al nacer.
5. **Trazabilidad:** cadena completa reconstruible para cualquier lote.
6. **Segregación:** firmante ≠ cerrador; permisos default-deny.
7. **Aditivo:** cambios al modelo agregan columnas/tablas al final, sin romper existentes.

---

## 9. Relación con otros documentos

| Documento | Contenido |
|---|---|
| `03-modelo-de-datos.md` | Diccionario campo por campo |
| `04-rbac.md` | Control de acceso |
| `05-flujos-operativos.md` | Recorrido paso a paso |
| `16-backend.md` | Por qué el backend no cambia |
| `17-api.md` | Cómo conectar el front-end futuro |
