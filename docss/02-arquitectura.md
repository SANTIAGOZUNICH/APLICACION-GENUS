# 02 — Arquitectura

Arquitectura conceptual y de datos del sistema. El detalle campo por campo está en `03-modelo-de-datos.md`; acá se explica **cómo encaja todo y cómo se mueve la información**.

---

## 1. Principios arquitectónicos (no negociables)

Estos principios son la base de la integridad GMP del sistema. **No deben romperse.**

1. **El inventario es un libro mayor append-only.** `MOVIMIENTOS` es la única fuente de verdad del stock. Nunca se edita ni se borra un movimiento; toda corrección es un movimiento nuevo (ajuste/contramovimiento).
2. **Los saldos son una caché derivada.** `SALDOS` se calcula como la suma de `MOVIMIENTOS` por lote. **Nunca se edita a mano.**
3. **Los estados se derivan, no se tipean.** El estado de un lote, de una orden, de un renglón de pedido, se determina por eventos del sistema, no por un campo que alguien escribe libremente. Esto elimina el error y garantiza auditabilidad.
4. **La fórmula vive en el BOM, versionada.** No vive en la OE. Cuando una OE nace, **congela** la versión de BOM que usó (`bom_version`), de modo que cambiar el BOM no altera órdenes pasadas.
5. **Dos barreras de liberación humanas.** El granel debe liberarse para poder acondicionarse; el PT debe liberarse para poder despacharse. Ambas son decisiones humanas firmadas, registradas de forma inmutable.
6. **Trazabilidad por lote.** Todo ítem (MP, ME, Granel, PT) se mueve por lote; la cadena PT → OA → Granel → OE → MP es reconstruible siempre.
7. **Segregación de funciones.** Quien ejecuta/cierra una orden no puede ser quien firma su liberación.

## 2. Entidades del sistema

Agrupadas por dominio. El diccionario completo está en `03-modelo-de-datos.md`.

- **Comercial:** `CLIENTES`, `PEDIDOS`, `PEDIDOS_DET`, `PRODUCTOS`.
- **Planificación / Producción:** `PLANIFICACION`, `OE`, `OE_CONSUMO`, `OA`, `OA_MATERIALES`, `BOM` (fórmulas y especificaciones).
- **Inventario:** `LOTES`, `MOVIMIENTOS`, `SALDOS`, maestros `MATERIAS_PRIMAS` (MP) y `MATERIALES_EMPAQUE` (ME).
- **Calidad:** `ANALISIS_CALIDAD`, `LIBERACIONES`.
- **Gobierno (RBAC):** `USUARIOS`, `ROLES`, `MODULOS`, `PERMISOS`.
- **Parámetros:** `PARAMETROS` (listas de valores: estados, unidades, tipos de movimiento, etc.).

## 3. Relaciones clave

- Un **PEDIDO** pertenece a un **CLIENTE** y tiene muchos **PEDIDOS_DET** (renglones), cada uno de un **PRODUCTO** (PT/SKU).
- La **PLANIFICACION** ordena la producción que satisface pedidos.
- Una **OE** produce **un granel** (un `LOTE` de tipo Granel) y consume MP (filas en `OE_CONSUMO`, cada una referenciando un `LOTE` de MP).
- Una **OA** produce **un PT** (un `LOTE` de tipo PT) a partir de un granel liberado, y consume ME (filas en `OA_MATERIALES`, cada una con su `LOTE` de ME). **Una OA = un PT.** Una OE-granel puede alimentar **muchas** OA/SKU.
- El **BOM** define la receta: `BOM_ELABORACION` (qué MP y cuánto, por granel) y `BOM_ACONDICIONAMIENTO` (qué ME, por PT). Versionado.
- `LOTES` es la entidad transversal: todo ítem se instancia como lote. Su `estado` es reflejo de la última `LIBERACIONES`.
- `MOVIMIENTOS` registra toda entrada/salida por lote; `SALDOS` lo resume.
- `ANALISIS_CALIDAD` aporta evidencia; `LIBERACIONES` registra la disposición firmada (append-only); el `estado` del lote refleja la última disposición.
- **RBAC:** `USUARIOS.ROL_ID` → `ROLES`; `PERMISOS` es la matriz `(ROL_ID, MODULO_ID, accion)`.

## 4. Cómo se mueve la información

### 4.1 Cómo se mueve un lote
1. **Nace** por una recepción (MP/ME) o por una producción (Granel en una OE; PT en una OA). En todos los casos se crea una fila en `LOTES` (estado inicial **Cuarentena** para granel/PT; los MP/ME entran y se analizan según corresponda) y un `MOVIMIENTOS` de entrada (Recepción o Producción, signo +).
2. **Se analiza:** Calidad carga `ANALISIS_CALIDAD`.
3. **Se dispone:** se registra una fila en `LIBERACIONES` (decisión: Liberado / Rechazado / Condicional / Bloqueado), firmada por Dirección Técnica. El `estado` del lote pasa a reflejar esa decisión.
4. **Se consume o se despacha:** cada consumo (en OE/OA) o despacho genera un `MOVIMIENTOS` de salida (signo −), bajando el `SALDOS` del lote.
5. **Eventos posteriores:** un lote liberado puede bloquearse luego (recall) → nueva fila en `LIBERACIONES`. El historial queda intacto.

### 4.2 Cómo se mueve un pedido
1. **Comercial** crea el `PEDIDO` (cliente) y sus `PEDIDOS_DET` (renglones de PT con cantidad y, idealmente, fecha de compromiso).
2. **Supervisor** lo planifica (`PLANIFICACION`) y genera las OE/OA necesarias.
3. A medida que se produce, libera y despacha, el **cumplimiento de cada renglón** se *deriva* de los `MOVIMIENTOS` de tipo Despacho imputados a ese `PEDIDO_DET_ID`: `despachado = Σ cantidades despachadas`; estado = Pendiente / Parcial / Completo. **No hay campo manual de cumplimiento.**

### 4.3 Cómo se mueve una OE
1. **Nace** desde planificación (estado Planificada), congelando `bom_version`.
2. **Iniciar** → En curso.
3. **Consumir MP**: cada MP del BOM se registra en `OE_CONSUMO` (lote + cantidad real), generando `MOVIMIENTOS` de Consumo (−).
4. **Controles de proceso** se registran.
5. Se **registra el lote de granel** producido (nace el `LOTE` Granel en Cuarentena + `MOVIMIENTOS` Producción +).
6. **Cierre** (Supervisor): la OE queda Cerrada (inmutable).
7. El granel pasa por la **barrera de liberación** antes de poder acondicionarse.

### 4.4 Cómo se mueve una OA
1. **Nace** ligada a un PT/SKU y a un granel **liberado** (estado Planificada), congelando `BOM_ACONDICIONAMIENTO`.
2. **Iniciar** → En curso.
3. **Consumir ME por lote**: cada ME se registra en `OA_MATERIALES` con su `LOTE` (resuelve el hueco GMP histórico) → `MOVIMIENTOS` Consumo (−).
4. **Controles de envasado** (inicio/medio/final), verificación de codificado/etiquetado, rendimiento.
5. Se **registra el lote de PT** producido (nace el `LOTE` PT en Cuarentena + `MOVIMIENTOS` Producción +).
6. **Cierre** (Supervisor).
7. El PT pasa por la **segunda barrera de liberación** antes de poder despacharse.

### 4.5 Cómo interactúan
El flujo es una cadena de eventos donde **el estado de salida de un paso es la condición de entrada del siguiente**, y cada transición habilita una tarea para el rol responsable (la "posta"). El inventario refleja cada evento como movimiento; los saldos se recalculan; las barreras de calidad detienen el flujo hasta la firma. Ver el recorrido completo en `05-flujos-operativos.md`.

## 5. Diagrama conceptual de flujo

```
CLIENTE → PEDIDO → PEDIDOS_DET
                       │
                   PLANIFICACION
                       │
                      OE ───(consume MP por lote)──→ OE_CONSUMO → MOVIMIENTOS(−)
                       │
                  LOTE Granel (Cuarentena)
                       │  ANALISIS_CALIDAD → LIBERACIONES(firma DT)
                  LOTE Granel (Liberado)
                       │
                      OA ───(consume ME por lote)──→ OA_MATERIALES → MOVIMIENTOS(−)
                       │
                  LOTE PT (Cuarentena)
                       │  ANALISIS_CALIDAD → LIBERACIONES(firma DT)
                  LOTE PT (Liberado)
                       │
                 DESPACHO (MOVIMIENTOS Despacho −, ref PEDIDO_DET)
                       │
                 Cumplimiento del renglón (derivado)
```
