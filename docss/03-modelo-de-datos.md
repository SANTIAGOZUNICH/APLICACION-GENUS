# 03 — Modelo de datos

Diccionario de datos del sistema. Cada tabla es una pestaña de Google Sheets consumida por AppSheet.

**Convenciones generales (ver `18-convenciones.md`):**
- IDs con prefijo: `MP-`, `ME-`, `L-`, `PT-`, `OE-`, `OA-`, `PED-`, `PD-`, `ANA-`, `LIB-`, `ROL-`, `MOD-`, `PRM-`.
- Fechas en formato `AAAA-MM-DD`. Marcas de tiempo `AAAA-MM-DD HH:MM:SS`.
- `MOVIMIENTOS` es **append-only**; `SALDOS` es **derivado/solo lectura**; `LIBERACIONES` es **append-only**.
- Estados provienen de listas en `PARAMETROS`.

> **Nota de fidelidad.** Las tablas marcadas **[VERIFICADA]** existen con la estructura exacta documentada en la base de producción. Las marcadas **[DISEÑADA]** están especificadas y aprobadas pero su construcción puede estar pendiente. Las marcadas **[PROPUESTA]** son recomendaciones de modelo para funcionalidad futura (ej. campos de planificación, precios). Cursor debe respetar lo VERIFICADO como inmutable y tratar lo DISEÑADO/PROPUESTO como contrato de implementación.

---

## Índice de tablas

Comercial: `CLIENTES`, `PEDIDOS`, `PEDIDOS_DET`, `PRODUCTOS` ·
Producción: `PLANIFICACION`, `OE`, `OE_CONSUMO`, `OA`, `OA_MATERIALES`, `BOM` ·
Inventario: `MATERIAS_PRIMAS`, `MATERIALES_EMPAQUE`, `LOTES`, `MOVIMIENTOS`, `SALDOS` ·
Calidad: `ANALISIS_CALIDAD`, `LIBERACIONES` ·
RBAC: `USUARIOS`, `ROLES`, `MODULOS`, `PERMISOS` ·
Sistema: `PARAMETROS`.

---

## CLIENTES  *(maestro comercial)* [DISEÑADA]
- **Objetivo:** marcas/empresas para las que el laboratorio fabrica.
- **Campos:** `CLIENTE_ID` (PK), `nombre`, `cuit`, `contacto`, `email`, `telefono`, `condiciones`, `activo`.
- **Clave:** `CLIENTE_ID`.
- **Relaciones:** 1—N con `PEDIDOS`.
- **Representa:** el cliente externo (Jactans, TMCO, TYL, etc.).
- **Quién la usa:** Administración / Comercial (alta y mantenimiento); lectura para el resto.

## PEDIDOS  *(cabecera de pedido)* [DISEÑADA]
- **Objetivo:** orden de compra del cliente.
- **Campos:** `PEDIDO_ID` (PK, `PED-AAAA-####`), `CLIENTE_ID` (FK), `fecha_pedido`, `fecha_compromiso` *(clave para nivel de servicio; confirmar presencia — ver `19`)*, `estado` (Abierto/En proceso/Completo/Cerrado), `observaciones`, `usuario_alta`.
- **Clave:** `PEDIDO_ID`.
- **Relaciones:** N—1 con `CLIENTES`; 1—N con `PEDIDOS_DET`.
- **Quién la usa:** Comercial (alta), Supervisor (planifica), Depósito (despacha).

## PEDIDOS_DET  *(renglón de pedido)* [DISEÑADA]
- **Objetivo:** cada línea de producto pedida.
- **Campos:** `PEDIDO_DET_ID` (PK, `PD-####-##`), `PEDIDO_ID` (FK), `PRODUCTO_ID` (FK a PRODUCTOS), `cantidad_pedida`, `unidad`, `despachado` (**derivado**: `SUMIFS(MOVIMIENTOS.cantidad, PEDIDO_DET_ID = este, tipo = "Despacho")`), `estado_cumplimiento` (**derivado**: Pendiente si despachado=0; Completo si despachado≥pedida; Parcial en otro caso).
- **Clave:** `PEDIDO_DET_ID`.
- **Relaciones:** N—1 con `PEDIDOS`; N—1 con `PRODUCTOS`; referenciado por `MOVIMIENTOS` de tipo Despacho.
- **Regla crítica:** el cumplimiento **no es un campo manual**; se deriva de los movimientos de despacho imputados al renglón.

## PRODUCTOS  *(maestro de producto terminado / SKU)* [DISEÑADA]
- **Objetivo:** catálogo de PT que el laboratorio fabrica.
- **Campos:** `PRODUCTO_ID` (PK, `PT-####`), `descripcion`, `CLIENTE_ID` (marca dueña), `presentacion` (mL/g), `unidad`, `BOM_ID_vigente`, `activo`.
- **Clave:** `PRODUCTO_ID`.
- **Relaciones:** N—1 con `CLIENTES`; 1—N con `PEDIDOS_DET`; 1—N con `OA`; ligado a `BOM`.
- **Quién la usa:** Comercial/Administración (alta), Producción (consulta).

## PLANIFICACION  *(programa de producción)* [DISEÑADA/PROPUESTA]
- **Objetivo:** ordenar qué se produce, cuándo y para qué pedido.
- **Campos:** `PLAN_ID` (PK), `PEDIDO_DET_ID` (FK, opcional), `PRODUCTO_ID`, `cantidad_plan`, `fecha_plan`, `prioridad`, `estado` (Planificada/En curso/Cerrada), `usuario`.
- **Relaciones:** origina `OE`/`OA`.
- **Quién la usa:** Supervisor (crea, confirma).

## BOM  *(fórmulas y especificaciones, versionado)* [DISEÑADA]
> En el lenguaje del usuario se lo menciona también como "FORMULAS"; en el modelo es `BOM` (Bill of Materials), con dos caras: elaboración y acondicionamiento.
- **Objetivo:** la receta. Define insumos por unidad producida; es la fuente de la fórmula (no la OE).
- **Campos (cabecera):** `BOM_ID` (PK), `PRODUCTO_ID`/`granel_ref`, `version`, `tipo` (Elaboración/Acondicionamiento), `densidad` (para granel), `estado` (Vigente/Obsoleta), `fecha_version`, `aprobado_por`.
- **Detalle Elaboración (`BOM_ELABORACION`):** `BOM_ID` (FK), `MP_ID` (FK), `cantidad_por_unidad`, `unidad`, `tolerancia`.
- **Detalle Acondicionamiento (`BOM_ACONDICIONAMIENTO`):** `BOM_ID` (FK), `ME_ID` (FK), `cantidad_por_unidad`, `unidad`.
- **Regla crítica:** la OE/OA **congela** `bom_version` al nacer. Cambiar un BOM **no** altera órdenes históricas.
- **Dominio validado:** Granel KG = `cantidad × mL / 1000 × densidad`.
- **Quién la usa:** Dirección Técnica / Calidad (define/aprueba), Producción (consume), Supervisor (al crear OE/OA).

## MATERIAS_PRIMAS (MP)  *(maestro de insumos de fórmula)* [VERIFICADA]
- **Objetivo:** catálogo de materias primas.
- **Campos:** `MP_ID` (PK, `MP-####`), `descripcion`, `unidad`, `proveedor_habitual`, otros atributos de ficha.
- **Relaciones:** referenciada por `LOTES` (tipo MP), `BOM_ELABORACION`, `OE_CONSUMO`.

## MATERIALES_EMPAQUE (ME)  *(maestro de materiales de empaque)* [VERIFICADA]
- **Objetivo:** catálogo de materiales de empaque (frascos, tapas, etiquetas, estuches).
- **Campos:** `ME_ID` (PK, `ME-####`), `descripcion`, `unidad`, `proveedor_habitual`.
- **Relaciones:** referenciada por `LOTES` (tipo ME), `BOM_ACONDICIONAMIENTO`, `OA_MATERIALES`.

## LOTES  *(entidad transversal de trazabilidad)* [VERIFICADA]
- **Objetivo:** instancia trazable de cualquier ítem (MP, ME, Granel, PT).
- **Campos (A–I):** `LOTE_ID` (PK, `L-####`), `tipo_item` (MP/ME/Granel/PT), `ITEM_ID` (FK al maestro correspondiente), `nro_lote` (texto sin espacios), `proveedor`, `fecha_recepcion`, `fecha_vencimiento`, `estado` (reflejo de la última `LIBERACIONES`), `coa_link`. Campo opcional adicional diseñado: `ultima_liberacion_ref`.
- **Clave:** `LOTE_ID`.
- **Relaciones:** 1—N con `MOVIMIENTOS`; 1—1 con fila de `SALDOS`; referenciado por `OE_CONSUMO`, `OA_MATERIALES`, `ANALISIS_CALIDAD`, `LIBERACIONES`.
- **Regla crítica:** `estado` **solo cambia vía `LIBERACIONES`**; nunca se edita a mano.
- **Datos reales:** existen `L-0001`…`L-0005` (MP/ME). `L-0010` es un PT de ejemplo ilustrativo.

## MOVIMIENTOS  *(libro mayor de inventario, append-only)* [VERIFICADA]
- **Objetivo:** registrar toda entrada/salida de stock por lote. **Única fuente de verdad del inventario.**
- **Campos (A–M + N–O):**
  `MOV_ID` (PK), `fecha_hora`, `tipo_item`, `ITEM_ID`, `LOTE_ID` (FK), `tipo_movimiento` (Recepción/Producción/Consumo/Despacho/Desecho/Ajuste +/Ajuste −), `cantidad`, `unidad`, `cantidad_signo` (**fórmula**: `=IF(OR(tipo="Consumo",tipo="Desecho",tipo="Despacho",tipo="Ajuste -"), -cantidad, cantidad)`), `motivo`, `usuario`, `referencia_tipo`, `referencia_id`, **`PEDIDO_ID`** (N), **`PEDIDO_DET_ID`** (O).
- **Clave:** `MOV_ID`.
- **Reglas críticas:** nunca se edita ni se borra; el signo lo calcula `cantidad_signo` (no se tipea negativo); las columnas `PEDIDO_ID`/`PEDIDO_DET_ID` van **al final** y no rompen fórmulas existentes; "Despacho" ya resta por la fórmula de signo.
- **Quién la usa:** todos los flujos que mueven stock (recepción, consumo en OE/OA, despacho, ajustes).

## SALDOS  *(caché de existencias, solo lectura)* [VERIFICADA]
- **Objetivo:** existencia actual por lote. **Derivada, nunca editable.**
- **Campos (A–H):** `LOTE_ID` (PK), `ITEM_ID` (fx), `tipo_item` (fx), `descripcion` (fx — lookup al maestro; extender a `PRODUCTOS` para mostrar PT), `cantidad_actual` (**fórmula**: `SUMIF(MOVIMIENTOS.LOTE_ID = este, MOVIMIENTOS.cantidad_signo)`), `unidad` (fx), `estado_lote` (fx — VLOOKUP a `LOTES`), `fecha_vencimiento` (fx).
- **Regla crítica:** ninguna celda de `SALDOS` se escribe a mano; todo sale de fórmulas sobre `MOVIMIENTOS`/`LOTES`.

## ANALISIS_CALIDAD  *(evidencia de control)* [DISEÑADA]
- **Objetivo:** registrar ensayos/controles de un lote (no es append-only; es un registro editable de trabajo de calidad).
- **Campos:** `ANALISIS_ID` (PK, `ANA-#####`), `LOTE_ID` (FK), `OA_ID`/`OE_ID` (FK, según corresponda), `tipo_analisis`, `ensayo` (lista `ENSAYO_PT`/parámetros), `especificacion`, `resultado`, `cumple` (Sí/No — lo determina Calidad en el MVP), `fecha`, `analista`.
- **Relaciones:** N—1 con `LOTES`; insumo de `LIBERACIONES`.
- **Quién la usa:** Calidad (carga), Dirección Técnica (consulta para firmar).

## LIBERACIONES  *(disposición de calidad, append-only)* [DISEÑADA]
- **Objetivo:** registrar la decisión firmada sobre un lote. **Inmutable.** Determina el `estado` del lote.
- **Campos:** `LIBERACION_ID` (PK, `LIB-#####`), `LOTE_ID` (FK), `OA_ID`/`OE_ID`, `decision` (lista `DECISION_LIBERACION`: Liberado/Rechazado/Condicional/Bloqueado), `cantidad_dispuesta`, `unidad`, `evidencia_conforme` (Sí/No), `registro_lote_revisado` (Sí/No), `reviso_calidad` (usuario), `fecha_revision`, `libero_direccion_tecnica` (usuario — la firma), `fecha_liberacion`, `motivo` (obligatorio si Rechazado/Condicional/Bloqueado), `fecha_venc_confirmada`, `fecha_evento`, `usuario_registro`, `observaciones`.
- **Reglas críticas:** append-only; **liberar NO mueve stock** (no genera movimiento); el `estado` del lote refleja la **última** fila de `LIBERACIONES`; la firma de DT es distinta de quien revisó en calidad (segregación).
- **Quién la usa:** Calidad (revisa/prepara), Dirección Técnica (firma).

## USUARIOS  *(identidad y rol)* [VERIFICADA]
- **Objetivo:** personas habilitadas y su rol.
- **Campos (A–E + F):** `email` (PK), `nombre`, `rol` (texto, **conservado** como respaldo legible; oculto/solo lectura), `area`, `activo`, **`ROL_ID`** (FK a `ROLES`).
- **Datos reales:** `belen@`→`ROL-OP` (Depósito), `santiago@`→`ROL-CA`, `agustina@`→`ROL-SU`, `caio@`→`ROL-DT`; todos `@laboratoriogenus.com.ar`.
- **Regla:** un rol por usuario (puente USUARIO_ROL diferido). El `area` diferencia operarios (Elaboración/Acondicionamiento/Depósito).

## ROLES  *(catálogo de roles)* [VERIFICADA — construida en F6.0]
- **Objetivo:** definir los roles del sistema.
- **Campos:** `ROL_ID` (PK, `ROL-XX`), `nombre`, `descripcion`, `activo`.
- **Datos:** 7 filas — `ROL-OP`, `ROL-SU`, `ROL-CA`, `ROL-DT`, `ROL-AD`, `ROL-DI` (activos) y `ROL-SV` (servicio/Creamy, inactivo).

## MODULOS  *(catálogo de módulos protegibles)* [VERIFICADA — construida en F6.0]
- **Objetivo:** las unidades funcionales sobre las que se otorgan permisos.
- **Campos:** `MODULO_ID` (PK, `MOD-XXX`), `nombre`, `descripcion`.
- **Datos (13):** `MOD-MP`, `MOD-ME`, `MOD-LOT`, `MOD-MOV`, `MOD-SAL`, `MOD-PED`, `MOD-PLA`, `MOD-OE`, `MOD-OEC`, `MOD-OA`, `MOD-OAM`, `MOD-ANA`, `MOD-LIB`.

## PERMISOS  *(matriz RBAC guiada por datos)* [VERIFICADA — construida en F6.0]
- **Objetivo:** definir qué acción puede ejecutar cada rol sobre cada módulo. **Default-deny.**
- **Campos:** `PERMISO_ID` (PK, `PRM-####`), `ROL_ID` (FK), `MODULO_ID` (FK), `accion` (Crear/Leer/Editar/Confirmar/Cerrar/Despachar/Ajuste/Firmar), `permitido` (TRUE/FALSE).
- **Datos:** 107 filas generadas desde la matriz aprobada (detalle en `04-rbac.md`).
- **Regla:** lo que no está explícitamente permitido, está denegado.

## PARAMETROS  *(listas de valores del sistema)* [VERIFICADA]
- **Objetivo:** centralizar enumeraciones: estados de lote, `DECISION_LIBERACION`, `ENSAYO_PT`, tipos de movimiento, unidades, estados de orden, etc.
- **Regla:** las listas de la UI (dropdowns, Valid_If) leen de acá; agregar un valor es agregar una fila, no tocar código.

---

## Notas de integridad transversales

1. **Append-only:** `MOVIMIENTOS` y `LIBERACIONES`. Jamás update/delete.
2. **Derivado:** `SALDOS` y los cumplimientos de `PEDIDOS_DET`. Jamás escritura manual.
3. **Estados derivados:** `LOTES.estado` = última `LIBERACIONES`. Estados de orden por transición de flujo.
4. **Congelado:** `bom_version` en OE/OA.
5. **Trazabilidad:** la cadena `PEDIDOS_DET → OA → LOTE(PT) → OA_MATERIALES(ME) / granel → OE → OE_CONSUMO(MP)` debe poder reconstruirse para cualquier lote.
