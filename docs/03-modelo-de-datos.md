# 03 — Modelo de datos

Diccionario de datos completo del sistema. Cada tabla es una pestaña de Google Sheets consumida por AppSheet.

---

## Convenciones generales

Ver `18-convenciones.md` para el detalle. Resumen:

- **IDs con prefijo:** `MP-`, `ME-`, `L-`, `PT-`, `OE-`, `OA-`, `PED-`, `PD-`, `ANA-`, `LIB-`, `ROL-`, `MOD-`, `PRM-`.
- **Fechas:** `AAAA-MM-DD`. **Marcas de tiempo:** `AAAA-MM-DD HH:MM:SS` (zona horaria Argentina).
- **Append-only:** `MOVIMIENTOS`, `LIBERACIONES`. Jamás UPDATE ni DELETE.
- **Derivado/solo lectura:** `SALDOS`, cumplimientos de `PEDIDOS_DET`.
- **Estados:** provienen de listas en `PARAMETROS`; no se tipean libremente.

### Leyenda de fidelidad

| Marca | Significado |
|---|---|
| **[VERIFICADA]** | Existe con la estructura exacta documentada en la base de producción. Inmutable. |
| **[DISEÑADA]** | Especificada y aprobada; construcción puede estar pendiente. Contrato de implementación. |
| **[PROPUESTA]** | Recomendación para funcionalidad futura. Confirmar antes de construir. |

---

## Índice de tablas

**Comercial:** `CLIENTES`, `PEDIDOS`, `PEDIDOS_DET`, `PRODUCTOS`

**Producción:** `PLANIFICACION`, `OE`, `OE_CONSUMO`, `OA`, `OA_MATERIALES`, `BOM`

**Inventario:** `MATERIAS_PRIMAS`, `MATERIALES_EMPAQUE`, `LOTES`, `MOVIMIENTOS`, `SALDOS`

**Calidad:** `ANALISIS_CALIDAD`, `LIBERACIONES`

**RBAC:** `USUARIOS`, `ROLES`, `MODULOS`, `PERMISOS`

**Sistema:** `PARAMETROS`

**Futuras (propuestas):** `TAREAS`, `INCIDENCIAS`, `DOCUMENTOS`, `CAPACITACIONES`

---

## DOMINIO COMERCIAL

### CLIENTES *(maestro comercial)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Marcas/empresas para las que el laboratorio fabrica |
| **Clave primaria** | `CLIENTE_ID` |
| **Quién la usa** | Administración/Comercial (alta y mantenimiento); lectura para el resto |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `CLIENTE_ID` | PK, texto | Identificador único del cliente |
| `nombre` | texto | Razón social o nombre comercial |
| `cuit` | texto | CUIT (identificación fiscal Argentina) |
| `contacto` | texto | Persona de contacto principal |
| `email` | texto | Email de contacto |
| `telefono` | texto | Teléfono de contacto |
| `condiciones` | texto largo | Condiciones comerciales (plazos, pagos, etc.) |
| `activo` | booleano | TRUE = cliente activo |

**Relaciones:**
- 1—N con `PEDIDOS`
- 1—N con `PRODUCTOS` (marca dueña del SKU)

**Representa:** el cliente externo (Jactans, TMCO, TYL, etc.).

---

### PEDIDOS *(cabecera de pedido)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Orden de compra del cliente |
| **Clave primaria** | `PEDIDO_ID` (formato `PED-AAAA-####`) |
| **Quién la usa** | Comercial (alta), Supervisor (planifica), Depósito (despacha) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `PEDIDO_ID` | PK, texto | `PED-AAAA-####` (ej. `PED-2026-0007`) |
| `CLIENTE_ID` | FK → CLIENTES | Cliente que realizó el pedido |
| `fecha_pedido` | fecha | Fecha de recepción del pedido |
| `fecha_compromiso` | fecha | Fecha de entrega comprometida *(clave para nivel de servicio; confirmar presencia — ver `19-pendientes.md`)* |
| `estado` | lista | Abierto / En proceso / Completo / Cerrado |
| `observaciones` | texto largo | Notas del pedido |
| `usuario_alta` | FK → USUARIOS.email | Quién registró el pedido |

**Relaciones:**
- N—1 con `CLIENTES`
- 1—N con `PEDIDOS_DET`

**Reglas:**
- El estado del pedido se deriva del cumplimiento de sus renglones.
- `fecha_compromiso` es necesaria para KPIs de nivel de servicio y alertas de "compromiso por vencer".

---

### PEDIDOS_DET *(renglón de pedido)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Cada línea de producto pedida |
| **Clave primaria** | `PEDIDO_DET_ID` (formato `PD-####-##`) |
| **Quién la usa** | Comercial (alta), Depósito (despacha), todos (seguimiento) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `PEDIDO_DET_ID` | PK, texto | `PD-####-##` (ej. `PD-0007-01`) |
| `PEDIDO_ID` | FK → PEDIDOS | Pedido al que pertenece |
| `PRODUCTO_ID` | FK → PRODUCTOS | PT/SKU pedido |
| `cantidad_pedida` | número | Cantidad solicitada |
| `unidad` | lista | Unidad de medida (unidades, cajas, etc.) |
| `despachado` | **derivado** | `SUMIFS(MOVIMIENTOS.cantidad, PEDIDO_DET_ID = este, tipo = "Despacho")` |
| `estado_cumplimiento` | **derivado** | Pendiente (despachado=0) / Parcial (0 < despachado < pedida) / Completo (despachado ≥ pedida) |

**Relaciones:**
- N—1 con `PEDIDOS`
- N—1 con `PRODUCTOS`
- Referenciado por `MOVIMIENTOS` de tipo Despacho (columnas `PEDIDO_ID`, `PEDIDO_DET_ID`)

**Regla crítica:** el cumplimiento **no es un campo manual**. Se deriva exclusivamente de los movimientos de despacho imputados al renglón.

---

### PRODUCTOS *(maestro de producto terminado / SKU)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Catálogo de PT que el laboratorio fabrica |
| **Clave primaria** | `PRODUCTO_ID` (formato `PT-####`) |
| **Quién la usa** | Comercial/Administración (alta), Producción (consulta) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `PRODUCTO_ID` | PK, texto | `PT-####` (ej. `PT-0001`) |
| `descripcion` | texto | Nombre/descripción del producto |
| `CLIENTE_ID` | FK → CLIENTES | Marca dueña del SKU |
| `presentacion` | texto | Presentación (mL, g, etc.) |
| `unidad` | lista | Unidad de medida |
| `BOM_ID_vigente` | FK → BOM | Fórmula vigente para este producto |
| `activo` | booleano | TRUE = producto activo |

**Relaciones:**
- N—1 con `CLIENTES`
- 1—N con `PEDIDOS_DET`
- 1—N con `OA`
- Ligado a `BOM` (elaboración del granel + acondicionamiento del PT)

---

## DOMINIO PRODUCCIÓN

### PLANIFICACION *(programa de producción)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Ordenar qué se produce, cuándo y para qué pedido |
| **Clave primaria** | `PLAN_ID` |
| **Quién la usa** | Supervisor (crea, confirma) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `PLAN_ID` | PK, texto | Identificador del plan |
| `PEDIDO_DET_ID` | FK → PEDIDOS_DET (opcional) | Renglón de pedido que satisface |
| `PRODUCTO_ID` | FK → PRODUCTOS | Producto a producir |
| `cantidad_plan` | número | Cantidad planificada |
| `fecha_plan` | fecha | Fecha objetivo de producción |
| `prioridad` | número/lista | Prioridad relativa |
| `estado` | lista | Planificada / En curso / Cerrada |
| `usuario` | FK → USUARIOS.email | Quién planificó |

**Relaciones:**
- Origen de `OE` y `OA`
- Opcionalmente ligado a `PEDIDOS_DET`

---

### OE *(Orden de Elaboración)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Orden para producir un granel (bulk) consumiendo materias primas |
| **Clave primaria** | `OE_ID` (formato `OE-####`) |
| **Quién la usa** | Supervisor (crea/cierra), Operario elaboración (ejecuta) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `OE_ID` | PK, texto | `OE-####` (ej. `OE-0042`) |
| `PLAN_ID` | FK → PLANIFICACION (opcional) | Plan que originó esta OE |
| `granel_ref` | texto/FK | Referencia al granel que se produce (descripción o ID de producto granel) |
| `bom_version` | texto | Versión de BOM **congelada** al crear la OE. No cambia si el BOM se actualiza. |
| `BOM_ID` | FK → BOM | Fórmula de elaboración usada |
| `tamano_lote` | número | Tamaño del lote a producir (ej. en KG) |
| `unidad` | lista | Unidad del tamaño de lote (KG, L, etc.) |
| `densidad` | número | Densidad del granel (para cálculo KG = cantidad × mL / 1000 × densidad) |
| `estado` | lista | Planificada / En curso / Cerrada |
| `LOTE_ID_granel` | FK → LOTES | Lote de granel producido (se asigna al registrar producción) |
| `fecha_creacion` | timestamp | Cuándo se creó la OE |
| `fecha_inicio` | timestamp | Cuándo pasó a En curso |
| `fecha_cierre` | timestamp | Cuándo se cerró (inmutable después) |
| `usuario_creacion` | FK → USUARIOS.email | Supervisor que creó |
| `usuario_cierre` | FK → USUARIOS.email | Supervisor que cerró |
| `observaciones` | texto largo | Notas de la orden |

**Relaciones:**
- 1—1 con `LOTE`(Granel) producido
- 1—N con `OE_CONSUMO`
- N—1 con `BOM` (vía `bom_version` congelada)
- Referenciada por `LIBERACIONES` (liberación del granel)

**Reglas críticas:**
- Al crear, **congela** `bom_version`. Cambiar el BOM no altera OEs históricas.
- Una OE produce **exactamente un granel**.
- Al cerrar, la OE es **inmutable**.
- El granel nace en estado **Cuarentena** y debe liberarse antes de acondicionarse.

**Estados y transiciones:**

```
Planificada → (iniciar) → En curso → (cerrar) → Cerrada
```

---

### OE_CONSUMO *(consumos de MP en una OE)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Registrar cada materia prima consumida por lote en una OE |
| **Clave primaria** | Compuesta: `OE_ID` + `MP_ID` + `LOTE_ID` (o ID propio `OEC-####`) |
| **Quién la usa** | Operario elaboración (registra), Supervisor (consulta/edita) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `OEC_ID` | PK, texto | Identificador del consumo (opcional, `OEC-####`) |
| `OE_ID` | FK → OE | Orden de elaboración |
| `MP_ID` | FK → MATERIAS_PRIMAS | Materia prima consumida |
| `LOTE_ID` | FK → LOTES | Lote específico de MP usado |
| `cantidad_teorica` | número | Cantidad según BOM (referencia) |
| `cantidad_real` | número | Cantidad realmente consumida |
| `unidad` | lista | Unidad de medida |
| `tolerancia` | número | Tolerancia permitida (del BOM) |
| `cumple_tolerancia` | **derivado** | TRUE si cantidad_real está dentro de tolerancia |
| `fecha_consumo` | timestamp | Cuándo se registró |
| `usuario` | FK → USUARIOS.email | Operario que registró |
| `MOV_ID` | FK → MOVIMIENTOS | Movimiento de consumo generado |

**Relaciones:**
- N—1 con `OE`
- N—1 con `LOTES` (tipo MP)
- Genera 1 `MOVIMIENTOS` de tipo Consumo (−)

**Validaciones (error-proofing):**
- `LOTE_ID` debe existir.
- El lote debe ser del `MP_ID` correcto (según BOM).
- El lote debe estar en estado **Liberado** (no Cuarentena, Rechazado, Bloqueado).
- El lote no debe estar **vencido**.
- `cantidad_real` ≤ `SALDOS.cantidad_actual` del lote.
- `cantidad_real` debe estar dentro de la tolerancia del BOM (o generar alerta de desvío).

---

### OA *(Orden de Acondicionamiento)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Orden para producir un PT envasando un granel liberado y consumiendo ME |
| **Clave primaria** | `OA_ID` (formato `OA-####`) |
| **Quién la usa** | Supervisor (crea/cierra), Operario acondicionamiento (ejecuta) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `OA_ID` | PK, texto | `OA-####` (ej. `OA-0031`) |
| `PLAN_ID` | FK → PLANIFICACION (opcional) | Plan que originó esta OA |
| `PRODUCTO_ID` | FK → PRODUCTOS | PT/SKU a producir |
| `LOTE_ID_granel` | FK → LOTES | Granel origen (debe estar **Liberado**) |
| `bom_version` | texto | Versión de BOM acondicionamiento **congelada** |
| `BOM_ID` | FK → BOM | Fórmula de acondicionamiento usada |
| `cantidad_plan` | número | Unidades de PT a producir |
| `unidad` | lista | Unidad (unidades, cajas) |
| `estado` | lista | Planificada / En curso / Cerrada |
| `LOTE_ID_pt` | FK → LOTES | Lote de PT producido (se asigna al registrar producción) |
| `fecha_creacion` | timestamp | Cuándo se creó |
| `fecha_inicio` | timestamp | Cuándo pasó a En curso |
| `fecha_cierre` | timestamp | Cuándo se cerró |
| `usuario_creacion` | FK → USUARIOS.email | Supervisor que creó |
| `usuario_cierre` | FK → USUARIOS.email | Supervisor que cerró |
| `observaciones` | texto largo | Notas |

**Relaciones:**
- 1—1 con `LOTE`(PT) producido
- 1—N con `OA_MATERIALES`
- N—1 con `LOTES`(Granel) origen
- N—1 con `PRODUCTOS`
- Referenciada por `LIBERACIONES`

**Reglas críticas:**
- **Una OA = un PT.** Una OE-granel puede alimentar **muchas** OA/SKU.
- El granel origen debe estar **Liberado** al crear la OA.
- Al crear, **congela** `bom_version` de acondicionamiento.
- Al cerrar, la OA es **inmutable**.
- El PT nace en **Cuarentena** y debe liberarse antes de despacharse.

**Estados y transiciones:**

```
Planificada → (iniciar) → En curso → (cerrar) → Cerrada
```

---

### OA_MATERIALES *(consumos de ME en una OA)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Registrar cada material de empaque consumido **por lote** en una OA. Resuelve el hueco GMP histórico. |
| **Clave primaria** | Compuesta: `OA_ID` + `ME_ID` + `LOTE_ID` (o ID propio `OAM-####`) |
| **Quién la usa** | Operario acondicionamiento (registra), Supervisor (consulta/edita) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `OAM_ID` | PK, texto | Identificador del consumo (opcional, `OAM-####`) |
| `OA_ID` | FK → OA | Orden de acondicionamiento |
| `ME_ID` | FK → MATERIALES_EMPAQUE | Material de empaque consumido |
| `LOTE_ID` | FK → LOTES | **Lote específico de ME usado** (campo crítico GMP) |
| `cantidad_teorica` | número | Cantidad según BOM |
| `cantidad_real` | número | Cantidad realmente consumida |
| `unidad` | lista | Unidad de medida |
| `fecha_consumo` | timestamp | Cuándo se registró |
| `usuario` | FK → USUARIOS.email | Operario que registró |
| `MOV_ID` | FK → MOVIMIENTOS | Movimiento de consumo generado |

**Relaciones:**
- N—1 con `OA`
- N—1 con `LOTES` (tipo ME)
- Genera 1 `MOVIMIENTOS` de tipo Consumo (−)

**Validaciones (error-proofing):**
- `LOTE_ID` debe existir y ser del `ME_ID` correcto.
- El lote debe estar **Liberado** y no vencido.
- `cantidad_real` ≤ saldo del lote.

**Importancia GMP:** este registro permite trazabilidad completa ME → PT. Antes del sistema, el lote de ME no se registraba en el acondicionamiento.

---

### BOM *(fórmulas y especificaciones, versionado)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | La receta. Define insumos por unidad producida. Fuente de la fórmula, no la OE/OA. |
| **Clave primaria** | `BOM_ID` + `version` |
| **Quién la usa** | Dirección Técnica/Calidad (define/aprueba), Producción (consume), Supervisor (al crear OE/OA) |

> En el lenguaje del usuario se menciona también como "fórmulas" o "FORMULAS"; en el modelo es `BOM` (Bill of Materials).

**Cabecera BOM:**

| Campo | Tipo | Descripción |
|---|---|---|
| `BOM_ID` | PK, texto | Identificador de la fórmula |
| `PRODUCTO_ID` / `granel_ref` | FK | Producto o granel al que aplica |
| `version` | texto/número | Versión (ej. `v1`, `v2`) |
| `tipo` | lista | Elaboración / Acondicionamiento |
| `densidad` | número | Densidad (para granel; cálculo KG) |
| `estado` | lista | Vigente / Obsoleta |
| `fecha_version` | fecha | Fecha de esta versión |
| `aprobado_por` | FK → USUARIOS.email | Quién aprobó |

**Detalle Elaboración (`BOM_ELABORACION`):**

| Campo | Tipo | Descripción |
|---|---|---|
| `BOM_ID` | FK | Fórmula padre |
| `MP_ID` | FK → MATERIAS_PRIMAS | Materia prima |
| `cantidad_por_unidad` | número | Cantidad por unidad de granel producido |
| `unidad` | lista | Unidad |
| `tolerancia` | número | Tolerancia permitida (%) |

**Detalle Acondicionamiento (`BOM_ACONDICIONAMIENTO`):**

| Campo | Tipo | Descripción |
|---|---|---|
| `BOM_ID` | FK | Fórmula padre |
| `ME_ID` | FK → MATERIALES_EMPAQUE | Material de empaque |
| `cantidad_por_unidad` | número | Cantidad por unidad de PT |
| `unidad` | lista | Unidad |

**Reglas críticas:**
- La OE/OA **congela** `bom_version` al nacer.
- Cambiar un BOM **no** altera órdenes históricas.
- Solo una versión **Vigente** por producto/granel.
- Fórmula validada: Granel KG = `cantidad × mL / 1000 × densidad`.

---

## DOMINIO INVENTARIO

### MATERIAS_PRIMAS (MP) *(maestro de insumos de fórmula)* [VERIFICADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Catálogo de materias primas |
| **Clave primaria** | `MP_ID` (formato `MP-####`) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `MP_ID` | PK, texto | `MP-####` |
| `descripcion` | texto | Nombre de la MP |
| `unidad` | lista | Unidad de medida habitual |
| `proveedor_habitual` | texto | Proveedor principal |
| *(otros)* | varios | Atributos de ficha técnica según necesidad |

**Relaciones:** referenciada por `LOTES` (tipo MP), `BOM_ELABORACION`, `OE_CONSUMO`.

---

### MATERIALES_EMPAQUE (ME) *(maestro de materiales de empaque)* [VERIFICADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Catálogo de materiales de empaque (frascos, tapas, etiquetas, estuches) |
| **Clave primaria** | `ME_ID` (formato `ME-####`) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `ME_ID` | PK, texto | `ME-####` |
| `descripcion` | texto | Nombre del ME |
| `unidad` | lista | Unidad de medida |
| `proveedor_habitual` | texto | Proveedor principal |

**Relaciones:** referenciada por `LOTES` (tipo ME), `BOM_ACONDICIONAMIENTO`, `OA_MATERIALES`.

---

### LOTES *(entidad transversal de trazabilidad)* [VERIFICADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Instancia trazable de cualquier ítem (MP, ME, Granel, PT) |
| **Clave primaria** | `LOTE_ID` (formato `L-####`) |
| **Quién la usa** | Todos los flujos que mueven stock |

**Campos (columnas A–I + opcional):**

| Campo | Tipo | Descripción |
|---|---|---|
| `LOTE_ID` | PK, texto | `L-####` (ej. `L-0005`) |
| `tipo_item` | lista | MP / ME / Granel / PT |
| `ITEM_ID` | FK | Al maestro correspondiente (MP_ID, ME_ID, PRODUCTO_ID, granel_ref) |
| `nro_lote` | texto | Número de lote del proveedor/fabricante (**sin espacios**) |
| `proveedor` | texto | Proveedor (para MP/ME) o "Genus" (para Granel/PT) |
| `fecha_recepcion` | fecha | Fecha de recepción o producción |
| `fecha_vencimiento` | fecha | Fecha de vencimiento |
| `estado` | lista | Reflejo de la última `LIBERACIONES` |
| `coa_link` | URL/texto | Link al certificado de análisis |
| `ultima_liberacion_ref` | FK → LIBERACIONES (opcional) | Última liberación que determinó el estado |

**Relaciones:**
- 1—N con `MOVIMIENTOS`
- 1—1 con fila de `SALDOS`
- Referenciado por `OE_CONSUMO`, `OA_MATERIALES`, `ANALISIS_CALIDAD`, `LIBERACIONES`

**Regla crítica:** `estado` **solo cambia vía `LIBERACIONES`**. Nunca se edita a mano.

**Datos reales:** existen `L-0001`…`L-0005` (MP/ME). `L-0010` es un PT de ejemplo ilustrativo.

**Estados posibles:** Cuarentena · Liberado · Rechazado · Condicional · Bloqueado · En reproceso · (Por vencer/Vencido derivados de fecha)

---

### MOVIMIENTOS *(libro mayor de inventario, append-only)* [VERIFICADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Registrar toda entrada/salida de stock por lote. **Única fuente de verdad del inventario.** |
| **Clave primaria** | `MOV_ID` |
| **Quién la usa** | Todos los flujos que mueven stock |

**Campos (columnas A–M + N–O):**

| Col | Campo | Tipo | Descripción |
|---|---|---|---|
| | `MOV_ID` | PK, texto | Identificador del movimiento |
| | `fecha_hora` | timestamp | Cuándo ocurrió |
| | `tipo_item` | lista | MP / ME / Granel / PT |
| | `ITEM_ID` | FK | Ítem movido |
| | `LOTE_ID` | FK → LOTES | Lote específico |
| | `tipo_movimiento` | lista | Recepción / Producción / Consumo / Despacho / Desecho / Ajuste + / Ajuste − |
| | `cantidad` | número | Cantidad (siempre positiva) |
| | `unidad` | lista | Unidad |
| | `cantidad_signo` | **fórmula** | `=IF(OR(tipo="Consumo",tipo="Desecho",tipo="Despacho",tipo="Ajuste -"), -cantidad, cantidad)` |
| | `motivo` | texto | Motivo del movimiento |
| | `usuario` | FK → USUARIOS.email | Quién registró |
| | `referencia_tipo` | texto | Tipo de entidad origen (OE, OA, PEDIDO, etc.) |
| | `referencia_id` | texto | ID de la entidad origen |
| N | `PEDIDO_ID` | FK → PEDIDOS | Para movimientos de Despacho |
| O | `PEDIDO_DET_ID` | FK → PEDIDOS_DET | Para movimientos de Despacho |

**Reglas críticas:**
- **Append-only.** Jamás UPDATE ni DELETE.
- El signo lo calcula `cantidad_signo` (fórmula). **Nunca** escribir cantidades negativas a mano.
- Las columnas `PEDIDO_ID`/`PEDIDO_DET_ID` van **al final** (N, O) para no romper fórmulas existentes.
- "Despacho" ya resta por la fórmula de signo.

---

### SALDOS *(caché de existencias, solo lectura)* [VERIFICADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Existencia actual por lote. **Derivada, nunca editable.** |
| **Clave primaria** | `LOTE_ID` |
| **Quién la usa** | Todos (consulta) |

**Campos (columnas A–H):**

| Campo | Tipo | Descripción |
|---|---|---|
| `LOTE_ID` | PK, FK → LOTES | Lote |
| `ITEM_ID` | fórmula (fx) | Lookup a maestro |
| `tipo_item` | fórmula (fx) | Del lote |
| `descripcion` | fórmula (fx) | Lookup al maestro (extender a PRODUCTOS para PT) |
| `cantidad_actual` | **fórmula** | `SUMIF(MOVIMIENTOS.LOTE_ID = este, MOVIMIENTOS.cantidad_signo)` |
| `unidad` | fórmula (fx) | Del maestro |
| `estado_lote` | fórmula (fx) | VLOOKUP a `LOTES.estado` |
| `fecha_vencimiento` | fórmula (fx) | Del lote |

**Regla crítica:** ninguna celda de `SALDOS` se escribe a mano. Todo sale de fórmulas sobre `MOVIMIENTOS`/`LOTES`.

---

## DOMINIO CALIDAD

### ANALISIS_CALIDAD *(evidencia de control)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Registrar ensayos/controles de un lote |
| **Clave primaria** | `ANALISIS_ID` (formato `ANA-#####`) |
| **Quién la usa** | Calidad (carga), Dirección Técnica (consulta para firmar) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `ANALISIS_ID` | PK, texto | `ANA-#####` |
| `LOTE_ID` | FK → LOTES | Lote analizado |
| `OE_ID` / `OA_ID` | FK (según corresponda) | Orden asociada |
| `tipo_analisis` | lista | Tipo de análisis (entrada, proceso, producto terminado) |
| `ensayo` | lista | Parámetro ensayado (de `ENSAYO_PT` en PARAMETROS) |
| `especificacion` | texto | Valor/rango esperado |
| `resultado` | texto/número | Valor obtenido |
| `cumple` | lista | Sí / No (lo determina Calidad en el MVP) |
| `fecha` | fecha | Fecha del análisis |
| `analista` | FK → USUARIOS.email | Quién realizó el análisis |

**Relaciones:** N—1 con `LOTES`; insumo de `LIBERACIONES`.

---

### LIBERACIONES *(disposición de calidad, append-only)* [DISEÑADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Registrar la decisión firmada sobre un lote. **Inmutable.** Determina el estado del lote. |
| **Clave primaria** | `LIBERACION_ID` (formato `LIB-#####`) |
| **Quién la usa** | Calidad (revisa/prepara), Dirección Técnica (firma) |

**Campos:**

| Campo | Tipo | Descripción |
|---|---|---|
| `LIBERACION_ID` | PK, texto | `LIB-#####` |
| `LOTE_ID` | FK → LOTES | Lote sobre el que se dispone |
| `OE_ID` / `OA_ID` | FK | Orden asociada |
| `decision` | lista | Liberado / Rechazado / Condicional / Bloqueado |
| `cantidad_dispuesta` | número | Cantidad sobre la que recae la decisión |
| `unidad` | lista | Unidad |
| `evidencia_conforme` | lista | Sí / No |
| `registro_lote_revisado` | lista | Sí / No |
| `reviso_calidad` | FK → USUARIOS.email | Quién revisó en calidad |
| `fecha_revision` | fecha | Cuándo revisó calidad |
| `libero_direccion_tecnica` | FK → USUARIOS.email | **Quién firmó** (acto legal) |
| `fecha_liberacion` | timestamp | Cuándo firmó DT |
| `motivo` | texto | Obligatorio si Rechazado/Condicional/Bloqueado |
| `fecha_venc_confirmada` | fecha | Vencimiento confirmado en la liberación |
| `fecha_evento` | timestamp | Timestamp del evento |
| `usuario_registro` | FK → USUARIOS.email | Quién registró |
| `observaciones` | texto largo | Notas |

**Reglas críticas:**
- **Append-only.** Jamás UPDATE ni DELETE.
- **Liberar NO mueve stock.** No genera movimiento.
- El `estado` del lote refleja la **última** fila de `LIBERACIONES`.
- La firma de DT es distinta de quien revisó en calidad (segregación GMP).
- Un lote liberado puede bloquearse después (recall) con una nueva fila.

---

## DOMINIO RBAC

### USUARIOS *(identidad y rol)* [VERIFICADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Personas habilitadas y su rol |
| **Clave primaria** | `email` |

**Campos (A–E + F):**

| Campo | Tipo | Descripción |
|---|---|---|
| `email` | PK, texto | Email corporativo (`@laboratoriogenus.com.ar`) |
| `nombre` | texto | Nombre completo |
| `rol` | texto | Texto legible del rol (respaldo; oculto/solo lectura) |
| `area` | lista | Elaboración / Acondicionamiento / Depósito / (otros para no-operarios) |
| `activo` | booleano | TRUE = usuario activo |
| `ROL_ID` | FK → ROLES | Rol del sistema |

**Datos reales:**

| Email | ROL_ID | Área |
|---|---|---|
| `belen@laboratoriogenus.com.ar` | `ROL-OP` | Depósito |
| `santiago@laboratoriogenus.com.ar` | `ROL-CA` | Calidad |
| `agustina@laboratoriogenus.com.ar` | `ROL-SU` | Supervisor |
| `caio@laboratoriogenus.com.ar` | `ROL-DT` | Dirección Técnica |

**Regla:** un rol por usuario. El `area` diferencia operarios.

---

### ROLES *(catálogo de roles)* [VERIFICADA — F6.0]

| Campo | Tipo | Descripción |
|---|---|---|
| `ROL_ID` | PK, texto | `ROL-XX` |
| `nombre` | texto | Nombre del rol |
| `descripcion` | texto | Descripción |
| `activo` | booleano | TRUE = rol activo |

**Datos (7 filas):** `ROL-OP`, `ROL-SU`, `ROL-CA`, `ROL-DT`, `ROL-AD`, `ROL-DI` (activos); `ROL-SV` (servicio/Creamy, inactivo).

---

### MODULOS *(catálogo de módulos protegibles)* [VERIFICADA — F6.0]

| Campo | Tipo | Descripción |
|---|---|---|
| `MODULO_ID` | PK, texto | `MOD-XXX` |
| `nombre` | texto | Nombre del módulo |
| `descripcion` | texto | Descripción |

**Datos (13 módulos):**

| ID | Nombre |
|---|---|
| `MOD-MP` | Materias primas |
| `MOD-ME` | Materiales de empaque |
| `MOD-LOT` | Lotes |
| `MOD-MOV` | Movimientos |
| `MOD-SAL` | Saldos |
| `MOD-PED` | Pedidos |
| `MOD-PLA` | Planificación |
| `MOD-OE` | Órdenes de elaboración |
| `MOD-OEC` | Consumos de OE |
| `MOD-OA` | Órdenes de acondicionamiento |
| `MOD-OAM` | Materiales de OA |
| `MOD-ANA` | Análisis de calidad |
| `MOD-LIB` | Liberaciones |

---

### PERMISOS *(matriz RBAC, default-deny)* [VERIFICADA — F6.0]

| Campo | Tipo | Descripción |
|---|---|---|
| `PERMISO_ID` | PK, texto | `PRM-####` |
| `ROL_ID` | FK → ROLES | Rol |
| `MODULO_ID` | FK → MODULOS | Módulo |
| `accion` | lista | Crear / Leer / Editar / Confirmar / Cerrar / Despachar / Ajuste / Firmar |
| `permitido` | booleano | TRUE / FALSE |

**Datos:** 107 filas generadas desde la matriz aprobada. Detalle en `04-rbac.md`.

**Regla:** lo que no está explícitamente permitido, está denegado.

---

## DOMINIO SISTEMA

### PARAMETROS *(listas de valores)* [VERIFICADA]

| Atributo | Valor |
|---|---|
| **Objetivo** | Centralizar enumeraciones del sistema |
| **Regla** | Agregar un valor = agregar una fila, no tocar código |

**Contenido típico:**
- Estados de lote (`DECISION_LIBERACION`)
- Ensayos de PT (`ENSAYO_PT`)
- Tipos de movimiento
- Unidades de medida
- Estados de orden (OE/OA)
- Estados de pedido
- Tipos de ítem

---

## TABLAS FUTURAS (PROPUESTAS)

### TAREAS [PROPUESTA]

Ver `09-bandeja-inteligente.md` para el diseño conceptual.

| Campo propuesto | Descripción |
|---|---|
| `TAREA_ID` | PK |
| `entidad_tipo` | OE / OA / LOTE / LIBERACION / PEDIDO / INCIDENCIA |
| `entidad_id` | FK a la entidad |
| `estado_entidad` | Estado que disparó la tarea |
| `accion_siguiente` | Qué debe hacer el responsable |
| `responsable_rol` | Rol asignado |
| `responsable_usuario` | Usuario específico (opcional) |
| `urgencia` | Puntaje calculado |
| `estado_tarea` | Pendiente / En curso / Completada / Cancelada |
| `fecha_creacion` | Cuándo se creó |
| `fecha_completada` | Cuándo se completó |
| `contexto` | JSON/texto con metadatos para la card |

---

## Notas de integridad transversales

1. **Append-only:** `MOVIMIENTOS` y `LIBERACIONES`.
2. **Derivado:** `SALDOS`, cumplimientos de `PEDIDOS_DET`, `cantidad_signo`.
3. **Estados derivados:** `LOTES.estado` = última `LIBERACIONES`.
4. **Congelado:** `bom_version` en OE/OA.
5. **Trazabilidad:** cadena `PEDIDOS_DET → OA → LOTE(PT) → OA_MATERIALES(ME) / granel → OE → OE_CONSUMO(MP)` reconstruible.
6. **Aditivo:** nuevas columnas/tablas al final, sin romper existentes.

---

## Relación con otros documentos

| Documento | Contenido |
|---|---|
| `02-arquitectura.md` | Cómo se mueve la información entre tablas |
| `04-rbac.md` | Matriz de permisos detallada |
| `05-flujos-operativos.md` | Qué tablas se tocan en cada paso |
| `18-convenciones.md` | Naming, estados, colores |
