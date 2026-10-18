# Ingreso de Materias Primas y Materiales de envase con foto de remito

**Dónde está.** Materia Prima → pestaña **Ingresos MP**, y Depósito → **Ingresos ME**: botones **«Nuevo ingreso con remito»** y **«Remitos recibidos»** (historial y consulta) arriba de la planilla.

## Flujo
1. **Foto**: sacar foto (cámara trasera en celular/tablet), subir imagen o PDF, varias hojas. Se crea un *borrador*: **no mueve stock**.
2. **Revisión**: formulario editable con la foto al lado (en celular, «Ver foto del remito»). Proveedor, n.º y fecha del remito, **fecha de recepción** (aparte), y una tarjeta por material: código del proveedor, descripción, **material de GENUS OS** (se elige del catálogo real), cantidad recibida, unidad, bultos, lote y vencimiento (MP), cantidad según remito (recepción parcial) y observaciones. Los campos ilegibles o ambiguos quedan marcados «Revisar».
3. **Resumen y confirmación**: sector, proveedor, remito, fechas, materiales, cantidades, lotes y responsable → **«Confirmar ingreso de stock»**.

## Reglas
- **No se crea ningún material.** El código del proveedor nunca se toma como código interno. Catálogo: ME = materiales de Depósito; MP = códigos que ya existen en Stock MP / libro mayor. Si no está, se pide el alta autorizada.
- Solo un **uso previo confirmado** (mismo proveedor + mismo código del proveedor) preselecciona el material; el resto son sugerencias a elegir.
- Unidades: MP en kg (acepta g y t); ME en la unidad del material. Lo inconvertible se rechaza. Cantidad > 0, lote obligatorio y vencimiento (o «Sin vencimiento») para MP. El **comprobante (foto/PDF) es obligatorio** para confirmar.
- **Sin sistema paralelo de stock**: MP confirma dentro de `runMpInventoryOp` (candado de MP, transacción) llamando a `upsertMpIngreso` (lote + libro mayor + auditoría); ME inserta en `inv_me_ingresos` (el stock de ME se deriva de ese libro) con candado por código.
- **Una sola vez**: la confirmación lleva una clave (`confirmKey`) y el borrador se bloquea (`FOR UPDATE`) y pasa a CONFIRMADO en la misma transacción. Doble clic / reintento = mismo resultado; otra clave sobre lo ya confirmado = 409; todo-o-nada si una línea falla.
- **Duplicados**: mismo proveedor + n.º de remito (tolera ceros a la izquierda) con mismos materiales y cantidades, o mismo archivo (sha256) → advertencia que hay que reconocer. Mismo remito con otro contenido = **recepción parcial**: no bloquea, se puede vincular a la anterior y suma solo lo recibido.
- **Trazabilidad**: `inventory_receipts` + `inventory_receipt_lines` (línea ↔ ingreso, proveedor, remito, lote, usuario, fecha) + archivos en `inventory_ingreso_adjuntos.receipt_id`. El comprobante de un ingreso confirmado no se puede quitar; agregar fotos al ingreso no genera movimientos. Correcciones de cantidad: ajuste con motivo (mecanismo existente).
- **Permisos (servidor)**: MP = Materia Prima y Dirección; ME = Depósito y Dirección. Producción y otros sectores con lectura solo consultan lo confirmado.

## Lectura automática (OCR / visión)
Desactivada por defecto. Reutiliza Gemini (`GEMINI_API_KEY`, ya presente para Creamy) pero solo se activa con **`INGRESO_REMITO_EXTRACTION=gemini`** (opcional `INGRESO_REMITO_GEMINI_MODEL`): enviar el remito a un servicio externo requiere esa autorización explícita. La respuesta se sanea (`sanitizeExtraction`): nunca se inventa, lo ausente queda vacío y «Revisar», y solo completa el formulario (no pisa lo ya escrito). Si falla o está apagada, la carga manual con foto funciona igual.

## Pruebas
`src/lib/inventory/receipt-rules.test.ts`, `src/integration/ingreso-remito.db.integration.test.ts` (`npm run test:e2e:ingreso-remito-db`), E2E de navegador `scripts/e2e/ingreso-remito-validate.mjs` (`npm run test:e2e:ingreso-remito`), `migration-reconcile.test.ts`.
