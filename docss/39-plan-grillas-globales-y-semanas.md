# 39 — Plan: grillas Excel globales, Asignación de Lotes bidireccional (opción C) y Semanas 2026

Estado: **auditoría + plan.** Etapa 1 parcialmente corregida (ver §6). Nada mergeado.

## 1. Auditoría del PR #109
- Motor `react-datasheet-grid` + `GenusGrid` (estados, rollback, preview, undo) y `PATCH /asignacion-lotes/cells` (parcial, atómico, versión `updatedAt`, auditoría en misma transacción).
- Corregido en esta pasada: el modal clásico (`upsert`) saltaba la matriz de sectores y la protección de filas de Google → ahora aplica la **misma política** campo por campo (solo valida los campos que realmente cambian). Tests agregados.
- **Colisión de migración 0039:** existen en otras ramas `0039_me_remito_ai.sql` (`feat/me-ingresos-desde-remito`) y `0039_asignacion_lotes_adoption_reconciliation.sql` (`fix/asignacion-lotes-adopt-historical-manual-records`). Mi `0039_asignacion_lotes_cell_audit.sql` choca. **Hay que decidir el orden de merge**; la mía se renumera al final (el SQL es independiente e idempotente). No lo renumeré a ciegas para no crear otro choque.
- **No verificado contra Neon:** este entorno no tiene `DATABASE_URL`. La transacción, el `date_trunc('milliseconds', updated_at)` y la migración solo se probaron en memoria / revisión de código. Necesito una **rama Neon de prueba** (`DATABASE_URL` de test).

## 2. Permisos reales de Google (verificado en código)
- `google-auth.ts` usa **`spreadsheets.readonly`** y `drive.readonly`. Hoy GENUS **no puede escribir** en ninguna Sheet. (Existe un scope `drive` completo solo para Remitos/COA.)
- Desde este entorno no hay salida a `docs.google.com` (HTTP 000) ni variables `GOOGLE_*`: no pude leer la Sheet real ni probar escritura.
- **Falta para la opción C (no lo pedí ni lo amplié):**
  1. Cambiar el scope a `https://www.googleapis.com/auth/spreadsheets` (solo para el cliente de escritura).
  2. Compartir con la cuenta de servicio, como **Editor**, las Sheets de Asignación de Lotes 2025/2026 y SEMANAS 2026.
  3. **Copias de prueba** de esas 3 planillas (no se tocan las productivas) + su `spreadsheetId`.
  4. Una rama/base Neon de prueba.

## 3. Estructura real de SEMANAS 2026 (copia local `SEMANAS 2026.xlsx` del repo; la Sheet viva no fue accesible)
| Pestaña | Rango | Combinadas | Fórmulas | Estructura |
|---|---|---|---|---|
| ELABORACION | A1:X1357 | 1.260 | 0 | Bloques semanales apilados: fila 1 `Lunes…Viernes` (B,D,F,H,J), fila 2 n° de día, fila 3 mes, luego responsable (p.ej. CRISTIAN) y bloques `cliente / producto / cantidad` por día; cada día ocupa 2 columnas combinadas |
| ACONDICIONAMIENTO | A1:M1275 | 1.806 | 6 | Mismo calendario; fila de sector (`ENVASADO CONSUMO MASIVO`), luego marca / producto-presentación / cantidad |
| ENTREGAS | B1:E1165 | 0 | 3 | Tabla plana `FECHA, CLIENTE, PRODUCTO, CANTIDAD` |
| QACONDDIA (= C/DIA) | B2:I1498 | 11 | 6 | Registro diario `FECHA, PRODUCTO, CANTIDAD, RESPONSABLE`; la fecha solo en la 1ª fila del día (celdas vacías = misma fecha); encabezados mensuales |
| DB | A1:AD982 | 117 | 106 | Dashboard: `SUMIFS(QACONDDIA!$D$4:$D$52…)` con **rangos de filas fijos por mes** → insertar filas en QACONDDIA puede mover esos rangos; DB es 100 % solo lectura |

Clasificación de celdas: **planificación editable** = textos/cantidades dentro de bloques de ELABORACION/ACONDICIONAMIENTO, filas de ENTREGAS y QACONDDIA; **estructurales** (protegidas) = fila de días, n° de día, mes, encabezados, celdas combinadas de bloque; **calculadas** = todo DB y las 15 fórmulas sueltas; **operativas confirmadas** = entregas ya confirmadas por el flujo (GENUS) y días cerrados.

Nota: el mapeo del calendario (celdas combinadas) → registros GENUS (`work_items`) **no es 1:1** (un bloque ocupa 2 columnas y varias filas; una producción puede abarcar 2 días). Ya existe un parser en `docss/27-f10-semanas-visual-blocks.md` y `lib/live-sync` que lo infiere. No se inventan equivalencias: el adaptador de escritura trabajará sobre **referencias exactas de celda** (ver §4) y solo para bloques que el parser identifica sin ambigüedad.

## 4. Diseño de referencias exactas y escritura segura (opción C y Semanas)
- Cada registro/celda sincronizado guarda `{spreadsheetId, sheetId (gid), a1 al momento de la lectura, valor leído, hash de la fila, clave estable}`. La **clave estable** (no el n° de fila): Asignación = (lote, código, producto) + pestaña; Semanas = (pestaña, fecha del día, columna de día, ancla del bloque = primer texto + responsable); Entregas = (fecha, cliente, producto, n° de ocurrencia).
- Escritura: (1) re-leer el rango de la fila/celda objetivo justo antes (`values.get`), (2) si el valor ≠ el último leído → **conflicto 409**, no se escribe, (3) re-localizar la fila por clave estable (soporta inserciones/borrados/reordenamientos), (4) `spreadsheets.values.update` de **una sola celda** (`USER_ENTERED` solo donde corresponde; nunca `values.clear`/`batchUpdate` de formato), (5) releer para confirmar, (6) recién ahí actualizar Neon + auditoría (valor anterior/nuevo, usuario, fecha, a1, revisión de la Sheet) en una transacción. Si Google falla: no se toca Neon y la UI muestra el error.
- El cron/sync compara contra el "último valor leído" guardado: un cambio confirmado desde GENUS actualiza ese baseline, por lo que el cron no lo revierte; un cambio hecho directamente en Google sigue entrando y pisa solo si GENUS no tiene edición pendiente (si la hay → conflicto visible).
- Nunca se envían fórmulas, celdas combinadas ni formato; se verifica antes que la celda destino no sea fórmula (`valueRenderOption=FORMULA`) ni parte de un rango protegido/combinado estructural.

## 5. Plan por etapas (PRs independientes)
1. **Etapa 1 (#109)** — completar: política unificada ✅; opción C (necesita §2); concurrencia real en Neon; migración renumerada; test de identidades simultáneas.
2. **Etapa 2 — Producción → Semanas** (prioridad): `GenusGrid` en modo "calendario" para ELABORACION/ACONDICIONAMIENTO (columnas Lun–Vie, bloques seleccionables/copiables/pegables), grillas planas para C/DIA y ENTREGAS (protegiendo confirmadas), DB solo lectura. Escritura con §4 sobre copia de prueba.
3. **Etapa 3** — Producción, Pedidos, Plan semanal.
4. **Etapa 4** — Depósito, inventarios, Material de Empaque, MP (ledger inmutable: solo selección/copia), Elaboración, Envasado, Codificado, Calidad.
5. **Etapa 5** — listados restantes y verificación global.
Cada etapa: tests unitarios, E2E de mouse/teclado/copy-paste (Playwright, como en #109), Neon real, Google real **solo en copias de prueba**, conflictos, build, PR, Preview; sin merge automático.

## 6. Qué necesito de vos para seguir con Etapa 1 (opción C) y Etapa 2
1. Confirmar el cambio de scope a `spreadsheets` (escritura) y compartir como Editor las **copias de prueba** (ids) de Asignación 2025/2026 y SEMANAS 2026.
2. `DATABASE_URL` de una rama Neon de prueba (o confirmar que el Preview de Vercel usa una).
3. Orden de merge para renumerar la migración (0039 hoy está tomada dos veces).
4. Acceso de lectura a la Sheet SEMANAS 2026 real (o un export `.xlsx` actualizado): la copia del repo es de febrero.
