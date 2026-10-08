# 40 — Write-back a Google (opción C), migraciones y Producción → Semanas

> Estado: implementado y probado **localmente** (Sheets simuladas / copia local del libro). **No** probado contra Google real ni Neon real: ver §6.

## 1. Migraciones — estrategia que no saltea ninguna (independiente del orden de merge)
`main` llega hasta `0038`. Las tres `0039` están en ramas **no mergeadas** (ninguna está en producción): `feat/me-ingresos-desde-remito` (`0039_me_remito_ai`), `fix/asignacion-lotes-adopt-historical-manual-records` (`0039_asignacion_lotes_adoption_reconciliation`) y #109 (que pasó a **`0040_asignacion_lotes_cell_audit`**). No se modificó ninguna migración ejecutada ni ninguna otra rama.

**Problema real:** el migrador de Drizzle aplica solo entradas del journal con `when` mayor al `created_at` más alto ya aplicado; una migración mergeada después con `when` menor se **saltea en silencio**. Renumerar archivos no lo evita.

**Solución (`scripts/lib/migration-reconcile.mjs`, corre en `scripts/migrate-if-database.mjs` justo después de `migrate()`):** para cada migración declarada *reconcile-safe* verifica por **hash sha256 del archivo** (el mismo que usa Drizzle) si está en `drizzle.__drizzle_migrations`; si falta, la aplica (sentencias separadas por `--> statement-breakpoint`, en transacción) y la registra con su `when`. Así, cualquiera sea el orden de merge, todas terminan aplicadas.
- *Reconcile-safe* = línea `-- genus:reconcile-safe` en el SQL (la de #109 la tiene) **o** tag en `KNOWN_RECONCILE_SAFE_TAGS` (las dos `0039` de las otras ramas, auditadas: solo `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). Las migraciones viejas (≤0038), las diferidas por gate (0005–0018, 0022) y las no marcadas **nunca** se reaplican.
- **Guardas (test `src/lib/db/migration-reconcile.test.ts`)**: tags únicos, `idx` consecutivos, archivo presente; toda migración posterior a 0038 debe ser reconcile-safe, sin `DROP/DELETE/TRUNCATE` y con `IF NOT EXISTS` en cada `CREATE/ALTER`; las ≤0038 no tienen la marca. Simulación del escenario real: producción ya aplicó A (`when` alto) y luego se mergea B (`when` menor) → Drizzle la saltea, la reconciliación la aplica; el orden inverso no hace nada; segunda corrida idempotente.
- Al mergear, el único conflicto esperable es textual en `_journal.json` (cada rama agrega una entrada al final): se resuelve conservando todas las entradas con `idx` consecutivos; el orden ya no afecta la corrección.
- **No probado contra Neon real** (ver §7): `src/integration/neon.integration.test.ts` corre el script real dos veces, simula una migración "saltada" y verifica que se reaplica.

La migración 0040 crea: `asignacion_lotes_cell_audit`, `asignacion_lotes_writeback_ops` (índice único parcial: una sola operación abierta por registro+campo), `sheet_cell_edits` (índice único parcial: una sola edición `pending` por celda; columnas `reason` y `affects_indicators`).

## 2. Asignación de Lotes — opción C (bidireccional)
Código: `lib/asignacion-lotes/{writeback-ops,writeback-gateway,asignacion-lotes-writeback-service}.ts`; entrada única: `PATCH /api/v1/asignacion-lotes/cells`.

Secuencia por celda de una fila sincronizada desde Google (idempotente y reanudable):
1. Validación sin escribir (sector, tipo, versión, duplicados de identidad).
2. Operación `pending` con clave de idempotencia = hash(registro, campo, valor, versión vista).
3. Relee la pestaña y **relocaliza la fila por identidad (lote+código+producto)** — no por n° de fila — soportando inserciones/borrados/reordenamientos; 0 coincidencias o >1 → no se escribe.
4. **Conflicto**: el valor actual en Google debe ser el último que GENUS leyó (el almacenado en Neon); si no → `GOOGLE_CONFLICT`, nada se escribe.
5. Rechaza celdas con fórmula. Escribe **UNA** celda (`values.update`, `USER_ENTERED`, fecha `dd/mm/aaaa`); relee para confirmar.
6. Refleja en Neon (+ auditoría de celda) y marca `confirmed`.

Estados y consistencia:
- Google rechaza → `failed`, Neon intacto, error visible.
- Google no confirma la relectura → `pending`, Neon intacto.
- Google confirma y Neon falla → `google_done`: la UI muestra **pendiente (no éxito)**; `reconcileWritebacks()` (cron, antes del sync) lo completa sin reescribir en Google; si la escritura nunca llegó a Google → `failed`.
- Éxito (`ok:true`) **solo** si Google y Neon quedaron consistentes. Fallo parcial en un pegado: respuesta por celda; la grilla marca en rojo solo las rechazadas.
- **El cron no revierte**: `upsertFromSource` no pisa un registro con escritura abierta o confirmada después de iniciada la corrida de lectura (`hasWritebackSince`).
- Filas manuales/Excel siguen igual (atómicas en Neon).

Seguridad (por defecto NO se escribe nada en ninguna planilla):
- Scope de escritura (`spreadsheets`) separado: `SHEETS_WRITE_SCOPES`, usado solo por `GoogleSheetCellGateway`; las lecturas siguen `readonly`.
- Doble llave: `ASIGNACION_LOTES_WRITEBACK=1` **y** el `spreadsheetId` dentro de `ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS`. Sin ambas → `PROTECTED_SOURCE` (solo lectura, como antes).
- La API de lista informa `writableSourceIds`; la grilla solo habilita esas fuentes.

## 3. Producción → Semanas (SEMANAS 2026)
Navegación: Producción → **Semanas** (`semanas_planilla`). Código: `lib/semanas-sheet/*`, `/api/v1/semanas/{grid,cells}`, `semanas-grid-view.tsx` (mismo `GenusGrid`).

Principio: **la Sheet es la única fuente de verdad**. GENUS la lee en vivo y escribe celdas; no hay copia editable en Neon (solo bitácora `sheet_cell_edits`). El sync existente Sheets → work-items sigue leyendo la planilla, por lo que los cambios fluyen sin un segundo camino.

| Pestaña | Presentación | Edición |
|---|---|---|
| ELABORACION / ACONDICIONAMIENTO | Calendario Lun–Vie por semana, igual a la planilla (bandas combinadas, responsables, bloques cliente/producto/cantidad) | Por celda **ancla** (B/D/F/H/J + fila). Protegidos: encabezados (día/fecha/mes), celdas combinadas no ancla, fórmulas y celdas de producto con **cierre de envasado/decisión de Calidad real en GENUS**. Semanas anteriores: **editables** (con motivo) |
| C/DIA (`QACONDDIA`) | Tabla plana (fecha heredada por día) | **Sin ventana de antigüedad.** Protegida solo si GENUS tiene la producción **cerrada** (cierre de envasado o decisión de Calidad ese día para ese producto). Fechas anteriores a hoy exigen **motivo**; CANTIDAD/RESPONSABLE (alimentan DB: `SUMIFS(QACONDDIA!D/E…)`) quedan marcadas `affects_indicators` en la bitácora |
| ENTREGAS | Tabla plana | Protegida por **estado real**: entrega `ENTREGADO` (no archivada/anulada/eliminada) o **remito no-borrador** en GENUS para ese cliente y fecha (criterio conservador: protege de más, nunca de menos). Una entrega histórica NO confirmada se puede corregir (con motivo) |
| DB | — | **No expuesta**: dashboard con 106 fórmulas (`SUMIFS(QACONDDIA!$D$4:$D$52…)` con rangos fijos). Nunca editable |

**Fail-closed:** si el estado operativo no se puede verificar (sin base o consulta fallida) ENTREGAS y C/DIA quedan **bloqueadas** (`UNKNOWN_LOCKS`) y la UI lo avisa.

Escritura de una celda (servidor, nunca confiando en el cliente): modelo vivo → estado operativo real → protección → motivo si es histórica → reserva de la celda (una sola edición `pending` por celda: dos usuarios a la vez → uno recibe `BUSY`) → valor remoto == lo que vio el usuario (si no, **conflicto**) → rechazo de fórmulas (también valores que empiezan con `=`) → una sola celda → relectura de confirmación → bitácora. No se envían estilos, combinadas ni formato; no se crean ni borran filas; no se toca ninguna otra celda (test: 1 celda cambiada de las miles del libro).

Doble llave para escribir: `SEMANAS_WRITEBACK=1` + `SEMANAS_WRITEBACK_SPREADSHEET_IDS` con el id de una **copia de prueba**. Sin eso la vista es de solo lectura y avisa. **Nunca en Production:** con `VERCEL_ENV=production` el write-back (Asignación y Semanas) queda deshabilitado aunque estén los flags (test).

Límites conocidos (no se inventan equivalencias):
- El calendario no mapea 1:1 a work-items (bloque de 2 columnas, producciones de 2 días): la grilla edita **celdas**, no registros; "mover una producción entre días" = copiar/pegar celdas y borrar el origen (varias celdas en una operación).
- Insertar/eliminar filas o semanas nuevas: no implementado (riesgo para `SUMIFS` fijos y combinadas).
- El año de las fechas viene de `SEMANAS_YEAR` (2026 por defecto) — la planilla no lo trae en el encabezado.
- **Fidelidad visual:** la grilla muestra cada día como UNA columna (Lun–Vie); las bandas combinadas (p. ej. `D4:I4`, `B4:K4`) aparecen en la celda ancla y las cubiertas quedan vacías/protegidas (el motor no tiene `colSpan`). La **Sheet conserva** celdas combinadas, fórmulas, formatos y distribución: se escribe `values.update` de UNA celda (nunca estilos ni combinadas) y los tests comparan combinadas/fórmulas/valores antes y después.
- La copia local del libro (`SEMANAS 2026.xlsx`, del repo) **no equivale** a la versión viva; no se pudo acceder a Google desde este entorno.

## 3 bis. Producción → Semanas: calendario fiel (celdas combinadas)

La vista de ELABORACION y ACONDICIONAMIENTO ya no es una tabla plana de 5 columnas: reproduce el calendario original.

| Aspecto de la Sheet | Cómo se representa |
|---|---|
| Bloques de semana apilados (Lunes…Viernes + n° de día + mes) | Un bloque por semana, con su etiqueta y filas de la Sheet (n° de fila a la izquierda, como Sheets) |
| Combinadas horizontales (banda del responsable B:K, bandas `D4:I4`, etc.) | `colSpan` real (1–5 días) |
| Combinadas verticales (`F15:G16`, `H188:I189`…) | `rowSpan` real; las celdas cubiertas no se dibujan |
| Colores de fondo / negrita / color de texto | Leídos **solo en lectura** (`spreadsheets.get`, `effectiveFormat`) y aplicados tal cual; si no se pueden leer, la vista sigue sin colores |
| Anchos de columna | Ancho de cada día = columna ancla + hermana, como en la Sheet |
| Alturas de fila y **semanas plegadas** (filas ocultas) | Las semanas plegadas en la Sheet no se muestran por defecto; casilla «Semanas plegadas en la Sheet (N)» para verlas |
| Selección / copiar / pegar / editar | Rangos con mouse o Shift+flechas, Ctrl+C (TSV; el valor de una combinación va en su esquina), Ctrl+V con vista previa, Enter / doble clic / escribir para editar, Supr, barra de valor (útil en móvil) |
| Protección | La del servidor: encabezados, combinadas no ancladas, fórmulas, registros cerrados en GENUS. Fechas anteriores a hoy → motivo obligatorio y auditado |
| «Ver como lista» | Conserva la grilla `GenusGrid` por semana (preferencia `genus_os_semanas_mode`) |
| ENTREGAS y C/DIA | Siguen en `GenusGrid` (son tablas planas en el original) |

**Por qué un renderer propio y no `GenusGrid`:** `react-datasheet-grid` no soporta celdas combinadas. Se reutilizan las mismas reglas (protección que viene del servidor, sin fórmulas, vista previa, motivo, rollback con error real, relectura de la Sheet tras guardar); el motor de tabla plana sigue siendo `GenusGrid`.

**Rendimiento:** cada semana monta su `<table>` solo cuando está a menos de ~900 px del viewport (IntersectionObserver); fuera de pantalla queda un marcador con la altura medida. Con la copia local del libro: 2 de 12 semanas montadas a la vez; el scroll horizontal es interno al contenedor (no ensancha la página).

**Qué NO cambió:** no se tocan fórmulas, no se escribe en las planillas originales (el formato se lee, jamás se escribe; el write-back sigue con doble llave y bloqueado en Production), no se modifican datos productivos.

**Validación:** `src/lib/semanas-sheet/{calendar-grid-model,sheet-formats}.test.ts`, `src/features/os/operational/components/semanas-calendar-grid.test.tsx` (combinadas, varias semanas, selección/copia, edición, protegidas, motivo histórico, rollback, 200 semanas) y `npm run test:e2e:semanas-visual` (Chromium real escritorio 1500 px y móvil 390 px sobre la copia local, con capturas).

**Limitaciones conocidas de fidelidad:** (1) bordes/fuentes/tamaños de letra y alineaciones de la Sheet no se reproducen (solo fondo, negrita, color de texto); (2) las celdas sin formato se ven con el tema de la app (la Sheet es blanca); (3) la columna A y las columnas L–X de la Sheet no se muestran; (4) congelar filas/columnas y filtros de la Sheet no se replican; (5) un cambio de estructura de la Sheet (otra disposición de B,D,F,H,J) requiere ajustar el modelo; (6) el formato de Google se verificó solo contra la copia local `.xlsx`, no contra la Sheet real (ver docss/42).

## 4. Variables de entorno (sin secretos)
| Variable | Uso |
|---|---|
| `ASIGNACION_LOTES_WRITEBACK=1` + `ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS=id1,id2` | Habilita write-back de Asignación solo en esas planillas |
| `SEMANAS_WRITEBACK=1` + `SEMANAS_WRITEBACK_SPREADSHEET_IDS=id` | Ídem para SEMANAS |
| `SEMANAS_SHEET_ID` | Fuerza el id de SEMANAS (p. ej. una copia de prueba); si no, se usa la planilla indexada `semanas_2026` |
| `SEMANAS_YEAR` | Año de las fechas del calendario |
| `GENUS_SEMANAS_FIXTURE_XLSX`, `SEMANAS_TODAY_OVERRIDE` | **Solo dev/test** (ignoradas en `NODE_ENV=production`): sirven un `.xlsx` local como si fuera la Sheet, con escrituras solo en memoria |

## 5. Estado por módulo
Ver el informe final del PR #109 (implementado / probado local / probado con servicios reales / pendiente).

## 6. Qué debés configurar vos (sin compartir secretos por chat)
1. **Copias de prueba** (File → Make a copy) de *Asignación de Lotes 2025*, *2026* y *SEMANAS 2026*; compartirlas como **Editor** con el email de la cuenta de servicio (el mismo `GOOGLE_SERVICE_ACCOUNT_EMAIL` que ya usa el sync). No se tocan las productivas.
2. En Vercel → Project → Settings → Environment Variables (solo entorno **Preview**): `ASIGNACION_LOTES_WRITEBACK=1`, `ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS=<id de la copia>`, `SEMANAS_WRITEBACK=1`, `SEMANAS_WRITEBACK_SPREADSHEET_IDS=<id de la copia>`, `SEMANAS_SHEET_ID=<id de la copia>`. En Preview, apuntar la fuente de Asignación a la copia (Configuración de fuentes de la app).
3. **Neon**: una rama Neon de prueba y su connection string cargada **solo** en el entorno Preview de Vercel como `DATABASE_URL` (Vercel → Settings → Environment Variables). El build corre `db:migrate` y aplica `0040`.
4. Con eso, correr la matriz de pruebas reales del §7.

## 7. Pruebas contra servicios reales (preparadas, NO ejecutadas aquí)
`src/integration/` (se saltan sin `GENUS_IT_*`; ver su README):
- `neon.integration.test.ts` — rama Neon **descartable** (`GENUS_IT_DATABASE_URL` directo + `GENUS_IT_CONFIRM_DISPOSABLE_DB=yes`): migraciones completas con el script real (2 corridas), reaplicación de una migración "saltada", persistencia/versión por `date_trunc` ms, auditoría transaccional, atomicidad, **dos usuarios misma celda**, **dos usuarios misma identidad de lote (DUPLICATE, no 500)**, índice único parcial de operaciones abiertas.
- `google-copy.integration.test.ts` — copias de Google (`GENUS_IT_GOOGLE_SEMANAS_COPY_ID`, `..._ASIGNACION_COPY_ID`, `..._ASIGNACION_TAB`, `GENUS_IT_GOOGLE_CONFIRM_COPIES=yes`): **se niega si el título no contiene copia/copy/test/prueba**; edita y revierte una celda comparando valores/combinadas/fórmulas; conflicto por cambio externo.
Qué configurar vos: §6.
