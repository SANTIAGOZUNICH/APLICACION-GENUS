# Lectura de remitos con IA — cómo funciona, cómo medirla y cómo habilitar la verificación real

## Qué pasa desde la foto hasta el formulario
1. **Navegador** (`prepare-receipt-image.ts`): corrige la orientación EXIF y achica solo si la foto pesa > 1,5 MB (hasta 2400 px / calidad 0,85; el límite de Vercel es ~4,5 MB por pedido). Sube cada foto (idempotente por SHA-256).
2. **Servidor** (`ReceiptService.extract`): toma el borrador, **reclama el trabajo de lectura de forma atómica** (`payload.job`: `running → done | failed`). Una segunda lectura del mismo borrador mientras otra sigue en curso devuelve `kind: "in_progress"` y **no llama de nuevo a la IA**. Si las fotos son exactamente las mismas que en la última lectura OK, se reutiliza el resultado (`payload.readCache`, clave = SHA-256 del conjunto) salvo «Releer» explícito (`fresh`).
3. **Proveedor de IA** (`receipt-extraction.ts`, Gemini): presupuesto total 54 s (`INGRESO_REMITO_BUDGET_MS`) y tope por intento 30 s (`INGRESO_REMITO_ATTEMPT_MS`), menor que `maxDuration = 60` de la ruta. Un intento colgado se corta y se prueba otro modelo; reintentos con tope (503/red/límite). Modelos «flash» sin presupuesto de razonamiento. Si la respuesta llega **cortada**, se rescatan encabezado y renglones completos (`salvagePartialJson`) y el borrador queda marcado «lectura parcial».
4. **Confianza por renglón** (`lineConfidence`): `ALTA` / `MEDIA` / `BAJA` según lo que el servicio marcó dudoso. Solo se resalta lo dudoso; un renglón ilegible no tira el remito. Todo se edita antes de confirmar.
5. **Pantalla**: muestra los segundos transcurridos; si la respuesta HTTP no llega (504/corte/red), **recupera el resultado guardado en el servidor** consultando el borrador (`view=get`) — nunca hay que volver a fotografiar. Al volver a abrir un borrador con una lectura en curso, se retoma.
6. **Identificación de MP** (segundo paso, no demora la lectura): código exacto → denominación ya confirmada con el proveedor → nombre normalizado → sinónimos (candidatos) → **IA sobre candidatos acotados** (`action: ai_suggest`, una llamada de texto, ≤ 25 renglones × 8 candidatos; el inventario completo nunca se envía). La respuesta se valida: código fuera de la lista → descartado; concentración/grado/presentación contradictorios → descartado; la IA nunca produce «ALTA» ni elige sola.
7. **Control de MP** (panel «Materias primas a resolver»): para cada MP, «Ver coincidencias / equivalencias» lista candidatos reales del Stock MP con motivo y confianza; «Confirmar equivalencia» guarda (en `mp_master_links`, sin migración) quién, cuándo y la denominación original, con historial (`name_alias_log`); «Desactivar» la quita. No toca stock ni fórmulas.

## Variables de entorno
| Variable | Efecto |
|---|---|
| `GEMINI_API_KEY` | Habilita la lectura (ya existente). |
| `INGRESO_REMITO_EXTRACTION=off` | Apaga la lectura. |
| `INGRESO_REMITO_BUDGET_MS` (54000) | Presupuesto total de una lectura. |
| `INGRESO_REMITO_ATTEMPT_MS` (30000) | Tope por intento. |
| `INGRESO_REMITO_GEMINI_MODEL` | Forzar un modelo (no recomendado: se descubre solo). |

## Cómo MEDIR en producción (nada de esto se midió con Gemini real al escribir este documento)
- Cada lectura exitosa registra en los logs de Vercel: `[ingreso-remito] lectura ok · MP|ME · <ms total> · proveedor de IA <ms> · <n> renglón(es) · <k> archivo(s)[ · desde caché][ · parcial]`. Los fallos registran su causa (`[ingreso-remito] lectura automática falló (...)`).
- Con **≥ 20 remitos reales** de proveedores distintos: filtrar esos logs y calcular mediana/percentil 90 de `<ms total>` y la proporción de fallos/`timeout`. Repetir con el MISMO lote de remitos antes/después de cualquier cambio de modelo o de preparación de imagen.
- Precisión: comparar a mano campo por campo (proveedor, n.º, fecha, código, descripción, cantidad, unidad, lote, vencimiento) contra la foto; contar renglones correctos / totales y renglones marcados `MEDIA`/`BAJA` que de hecho estaban mal (calibración de la confianza).
- Salud de la configuración (Dirección/Producción): `GET /api/v1/inventory/receipts?module=MP&view=extraction_health&image=1` (lee un remito ficticio incorporado; no envía documentos reales).

## Pruebas automáticas
- Unitarias: `receipt-extraction-robust.test.ts` (intento colgado, respuesta cortada, línea ilegible, comparación simulada antes/después — **tiempos simulados, no de Gemini real**), `mp-identity.test.ts`, `mp-ai-identify.test.ts`.
- Postgres descartable: `npm run test:e2e:ingreso-remito-db` (trabajo persistente, concurrencia, caché, IA validada) y `bash scripts/e2e/run-mp-alias-db-local.sh` (equivalencias: quién/cuándo/original, historial, rechazo por concentración, stock intacto).
- Navegador (Chromium, celular Pixel 7, tablet 820 px y escritorio, Gemini simulado): `npm run test:e2e:ingreso-remito-lectura` (incluye «respuesta perdida → resultado recuperado sin nueva foto»).
