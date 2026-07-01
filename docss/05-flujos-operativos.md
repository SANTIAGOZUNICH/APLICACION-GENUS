# 05 — Flujos operativos

El laboratorio de punta a punta. Para cada paso: **quién participa · qué valida · qué genera**.

Cadena macro:

```
Pedido → Planificación → OE → Consumo MP → Granel → (Liberación granel)
       → OA → Consumo ME → Producto Terminado → Calidad → Liberación PT → Despacho
```

---

## Paso 0 — Recepción de insumos (MP / ME)
- **Quién:** Depósito (recibe), Calidad (analiza).
- **Qué valida:** que exista el ítem en el maestro; datos de lote (nro, vencimiento, proveedor, remito); cantidad recibida.
- **Qué genera:** una fila en `LOTES` (tipo MP/ME, estado inicial **Cuarentena**), un `MOVIMIENTOS` de **Recepción** (+), y la cola de análisis para Calidad. Un insumo no puede consumirse hasta estar **Liberado**.

## Paso 1 — Pedido
- **Quién:** Comercial / Administración.
- **Qué valida:** cliente válido; producto(s) válidos; cantidades; idealmente fecha de compromiso.
- **Qué genera:** `PEDIDOS` (cabecera) + `PEDIDOS_DET` (renglones). Cada renglón nace con cumplimiento **Pendiente** (derivado).

## Paso 2 — Planificación
- **Quién:** Supervisor.
- **Qué valida:** demanda (pedidos) vs. capacidad; disponibilidad de granel/insumos; prioridad y fecha.
- **Qué genera:** `PLANIFICACION` y, a partir de ella, las **OE** (para producir granel) y **OA** (para envasar PT) necesarias. Confirmar el plan habilita la creación de órdenes.

## Paso 3 — Orden de Elaboración (OE)
- **Quién:** Supervisor (crea/cierra), Operario de elaboración (ejecuta).
- **Qué valida al crear:** producto/granel y su **BOM vigente**; la OE **congela** `bom_version`; tamaño de lote; densidad.
- **Qué genera:** una `OE` en estado **Planificada**.

## Paso 4 — Consumo de MP (dentro de la OE)
- **Quién:** Operario de elaboración.
- **Qué valida (error-proofing):** el lote escaneado/seleccionado **existe**, es del **ítem correcto** (MP del BOM), está **Liberado** (no en cuarentena/rechazado), **no vencido**, y la **cantidad ≤ saldo** del lote y coherente con la fórmula y su tolerancia. No permite guardar fuera de esas reglas.
- **Qué genera:** filas en `OE_CONSUMO` (lote + cantidad real) y, por cada una, un `MOVIMIENTOS` de **Consumo** (−) que baja el `SALDOS` del lote de MP. La OE pasa a **En curso**.

## Paso 5 — Granel
- **Quién:** Operario (registra producción), Supervisor (cierra OE).
- **Qué valida:** controles de proceso (p. ej. pH, aspecto) según corresponda; rendimiento; coherencia de cantidad producida.
- **Qué genera:** un `LOTE` de **Granel** (estado **Cuarentena**) + `MOVIMIENTOS` de **Producción** (+). Al cerrar, la OE queda **Cerrada** (inmutable).

## Paso 6 — Liberación del granel (primera barrera)
- **Quién:** Calidad (analiza y prepara), Dirección Técnica (firma).
- **Qué valida:** ensayos del granel contra especificación (`ANALISIS_CALIDAD`); revisión del registro de lote; conformidad de evidencia.
- **Qué genera:** una fila en `LIBERACIONES` con la **decisión firmada** (Liberado/Rechazado/Condicional/Bloqueado). El `estado` del lote de granel pasa a reflejarla. **Solo un granel Liberado puede acondicionarse.** Liberar **no mueve stock**.

## Paso 7 — Orden de Acondicionamiento (OA)
- **Quién:** Supervisor (crea/cierra), Operario de acondicionamiento (ejecuta).
- **Qué valida al crear:** PT/SKU y su `BOM_ACONDICIONAMIENTO` vigente (congela versión); que el **granel origen esté Liberado**; cantidad de unidades a producir. **Una OA = un PT.**
- **Qué genera:** una `OA` en estado **Planificada**.

## Paso 8 — Consumo de ME (dentro de la OA)
- **Quién:** Operario de acondicionamiento.
- **Qué valida (error-proofing):** **cada material de empaque se registra por lote** (resuelve el hueco GMP histórico de no registrar el lote de ME); lote correcto, liberado, no vencido, cantidad ≤ saldo; consumo del granel liberado.
- **Qué genera:** filas en `OA_MATERIALES` (ME + lote) y `MOVIMIENTOS` de **Consumo** (−) de ME y del granel. La OA pasa a **En curso**.

## Paso 9 — Producto Terminado (PT)
- **Quién:** Operario (registra), Supervisor (cierra OA).
- **Qué valida:** controles de envasado (inicio/medio/final), codificado y etiquetado correctos, rendimiento, conciliación de unidades.
- **Qué genera:** un `LOTE` de **PT** (estado **Cuarentena**) + `MOVIMIENTOS` de **Producción** (+). Al cerrar, la OA queda **Cerrada**.

## Paso 10 — Calidad del PT y Liberación (segunda barrera)
- **Quién:** Calidad (analiza/prepara), Dirección Técnica (firma).
- **Qué valida:** ensayos del PT contra especificación; revisión del registro de lote completo (incluye trazabilidad de granel y ME); conformidad.
- **Qué genera:** `ANALISIS_CALIDAD` + una fila en `LIBERACIONES` firmada. El PT pasa a **Liberado** (o Rechazado/Condicional/Bloqueado). **Solo un PT Liberado puede despacharse.**

## Paso 11 — Despacho
- **Quién:** Depósito.
- **Qué valida (obligatorio):** solo PT; solo lote en estado **Liberado**; **cantidad ≤ saldo**; `PEDIDO_ID`/`PEDIDO_DET_ID` presentes; que el **producto del lote = producto del renglón** (`LOTES.ITEM_ID = PEDIDOS_DET.PRODUCTO_ID`); lote **no vencido**; cantidad > 0. No tocar `LOTES`/`SALDOS` a mano.
- **Qué genera:** `MOVIMIENTOS` de **Despacho** (−, con `PEDIDO_ID`/`PEDIDO_DET_ID`). El despacho **no usa una entidad "Orden de Despacho"**: se hace directo contra el renglón del pedido. El **cumplimiento del renglón se deriva**: `despachado = Σ despachos del renglón`; estado = Pendiente / Parcial / Completo.

## Ejemplo de extremo a extremo (piloto)
Un PT `L-0010` (`PT-0001`) registra Producción **+1000** unidades. Se despacha **600** contra `PED-2026-0007` / `PD-0007-01`: queda saldo **400** y el renglón (pedido 1000) en estado **Parcial**. Toda la cadena —desde la MP consumida en la OE del granel hasta esas 600 unidades despachadas— es trazable.

---

## La posta (resumen de transiciones que disparan tareas)

| Evento (estado) | Tarea que aparece | Para el rol |
|---|---|---|
| OE marcada lista | Cerrar OE | Supervisor |
| OE cerrada → granel en cuarentena | Analizar/disponer | Calidad |
| Disposición en borrador | Firmar liberación | Dirección Técnica |
| Granel liberado | Crear/iniciar OA | Supervisor / Operario acond. |
| OA cerrada → PT en cuarentena | Analizar/disponer | Calidad |
| PT liberado | Despachar contra pedido | Depósito |
| Despacho registrado | Seguimiento de pedido | Comercial |
| Faltante / desvío / vencimiento | Resolver problema | Supervisor / Calidad |
