# 40 — Write-back a Google (opción C), migraciones y Producción → Semanas

> Estado: implementado y probado **localmente** (Sheets simuladas / copia local del libro). **No** probado contra Google real ni Neon real: ver §6.

## 1. Migraciones (verificado con `git ls-tree origin/main`)
`main` llega hasta `0038`. Las tres `0039` son de ramas **no mergeadas** (ninguna está en producción):

| Rama | Archivo | `when` en el journal |
|---|---|---|
| `feat/me-ingresos-desde-remito` | `0039_me_remito_ai` | 1790300000000 |
| `fix/asignacion-lotes-adopt-historical-manual-records` | `0039_asignacion_lotes_adoption_reconciliation` | 1790900000000 |
| PR #109 (antes) | `0039_asignacion_lotes_cell_audit` | 1790300000000 |

No se inventó un orden de merge. Cambio hecho **solo en #109** (no se tocó ninguna migración aplicada ni ninguna otra rama): la migración pasó a **`0040_asignacion_lotes_cell_audit`** con `when = 1791100000000` (> a las otras dos) y SQL 100 % idempotente (`IF NOT EXISTS`).

⚠️ Regla de Drizzle a respetar al mergear: el migrador aplica solo migraciones con `when` mayor al de la última ya aplicada. Si `0039_asignacion_lotes_adoption_reconciliation` (1790900000000) se mergea **después** de una `0040` ya desplegada, Drizzle la **salteará**. Quien mergee segundo debe subir el `when` de su entrada del journal por encima del último desplegado (y renumerar si choca el nombre). Esto no puede resolverse sin conocer el orden real de merge.

La migración 0040 crea: `asignacion_lotes_cell_audit`, `asignacion_lotes_writeback_ops`, `sheet_cell_edits` (todas tablas nuevas, sin tocar datos existentes).

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
| ELABORACION / ACONDICIONAMIENTO | Calendario Lun–Vie por semana, igual a la planilla (bandas combinadas, responsables, bloques cliente/producto/cantidad) | Por celda **ancla** (B/D/F/H/J + fila). Protegidos: encabezados (día/fecha/mes), celdas combinadas no ancla, fórmulas, semanas anteriores a la actual |
| C/DIA (`QACONDDIA`) | Tabla plana (fecha heredada por día) | Editable en los últimos 14 días y futuro; antes = "día cerrado" (**supuesto de política**, ajustable en `CDIA_EDIT_WINDOW_DAYS`) |
| ENTREGAS | Tabla plana | Editable desde hoy; fechas anteriores = entregas históricas protegidas. *Pendiente*: protegerlas también por estado real del flujo operativo (entregas confirmadas en GENUS) |
| DB | — | **No expuesta**: dashboard con 106 fórmulas (`SUMIFS(QACONDDIA!$D$4:$D$52…)` con rangos fijos). Nunca editable |

Escritura de una celda (servidor, nunca confiando en el cliente): modelo vivo → protección → valor remoto == lo que vio el usuario (si no, **conflicto**) → rechazo de fórmulas (también valores que empiezan con `=`) → una sola celda → relectura de confirmación → bitácora. No se envían estilos, combinadas ni formato; no se crean ni borran filas; no se toca ninguna otra celda (test: 1 celda cambiada de las miles del libro).

Doble llave para escribir: `SEMANAS_WRITEBACK=1` + `SEMANAS_WRITEBACK_SPREADSHEET_IDS` con el id de una **copia de prueba**. Sin eso la vista es de solo lectura y avisa.

Límites conocidos (no se inventan equivalencias):
- El calendario no mapea 1:1 a work-items (bloque de 2 columnas, producciones de 2 días): la grilla edita **celdas**, no registros; "mover una producción entre días" = copiar/pegar celdas y borrar el origen (varias celdas en una operación).
- Insertar/eliminar filas o semanas nuevas: no implementado (riesgo para `SUMIFS` fijos y combinadas).
- El año de las fechas viene de `SEMANAS_YEAR` (2026 por defecto) — la planilla no lo trae en el encabezado.
- La copia local del libro (`SEMANAS 2026.xlsx`, del repo) **no equivale** a la versión viva; no se pudo acceder a Google desde este entorno.

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

## 7. Pruebas reales pendientes (necesitan 1–3)
Persistencia y concurrencia reales en Neon (`date_trunc` ms, transacción, índice único de ops); escritura/relectura reales en Sheets de prueba (locale de fechas, `USER_ENTERED`); inserción de fila arriba durante una edición; cron real sin revertir; reconciliación tras corte entre Google y Neon.
