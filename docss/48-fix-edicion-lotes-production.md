# 48 — Bug en Production: no se pueden editar las celdas de Asignación de lotes (después del PR #112)

Estado al 2026-10-09. Rama `claude/fix-lotes-edicion-production`, que parte de `main` en a6b9b23 (contiene el PR #112). **Sin migraciones nuevas.**

## 1. Qué se verificó, punto por punto

| # | Pedido | Resultado |
|---|---|---|
| 1 | ¿Production ejecuta el commit del PR #112? | `main` está en **a6b9b23** (merge del #112, 15:18 UTC). Desde este entorno **no se puede leer Production**: el proxy de red rechaza `appgenus.vercel.app` (403) y no hay acceso a Vercel ni a Neon. Con este PR, `GET /api/v1/version` y `GET /api/v1/env-check` informan el commit desplegado (`build`). |
| 2 | ¿0043 está aplicada en Neon? | No se pudo consultar Neon, y no se ejecutó ninguna migración manual. Revisé la cadena del build: `npm run build` corre `migrate-if-database.mjs` (Drizzle + reconciliación). 0043 está en el journal (idx 41) y en la lista de reconciliación con su hash, que coincide con el archivo. Sus 7 sentencias pasan la validación de DDL aditivo. Con este PR, `/api/v1/env-check` → `asignacionLotesLocalEdits: { ready, missing }` lo responde en Production con solo leer `information_schema`. |
| 3 | Permisos y candados | Matriz `CELL_EDIT_SECTORS`: Producción edita lote, fecha, producto, código, marca, cantidades, VTO y observaciones. Calidad, además, muestras, CJ y fecha de análisis. En #112, `cellProtectionReason` ya **no** bloquea por `sourceId`. En #111 sí: «Registro sincronizado desde Google Sheets… Corregilo en la Sheet». |
| 4 | Formulario vs. grilla | El formulario usa `upsert` → `writeRecord` (versión + auditoría + capa local). La grilla usa `PATCH /cells` → `patchCellsWithWriteback` → `patchCells`, y solo va a Google si la fuente tiene write-back habilitado (nunca en Production). Las dos guardan en la capa de ediciones. |
| 5 | ¿Las filas de Google siguen en solo lectura? | **Con el código de #112 y 0043 aplicada, no.** Se probó con un build de producción (`next build` + `next start`, `VERCEL_ENV=production`) y filas sincronizadas **antes** de 0043, como las reales, sin identidad de origen. Producción edita, guarda, recarga y sincroniza (E2E 30/30). |
| 6 | Bloqueo exacto | No es de permisos ni de la lógica de candados de #112. La grilla queda sin poder guardar **solo** si la pantalla o el servidor no corren #112 con 0043. Hay dos caminos, y los dos eran **silenciosos** (ver §2). |
| 7 | Corrección | Ver §3. No se habilitó ninguna escritura a Google y la capa de ediciones locales no cambió. |

## 2. Causa: los dos caminos que dejaban la grilla sin guardar, sin avisar

**A. Frontend: la pestaña o la PWA siguen con el código anterior (candados de #111).**

- La app cambia de pantalla sin recargar. Una pestaña o la PWA que quedó abierta desde antes del deploy sigue con el JavaScript viejo, donde las filas de Google tienen candado.
- El service worker no lo detectaba. Se registra con `sw.js?build=<sha viejo>` y `sw.js` no cambia entre deploys. Por eso `reg.update()` nunca encuentra una versión nueva y el aviso «Hay una nueva versión» no aparecía.
- Resultado: el PR estaba desplegado y la pantalla seguía bloqueada.

**B. Migración: el código de #112 corre contra una base sin 0043.**

- El código nuevo lee `source_lote/codigo/producto`, `cell_audit.reason` y `asignacion_lotes_local_edits`. Sin ellas (reproducido con la base descartable):
  - `GET` y `PATCH` → **500 «No se pudo completar la operación»**.
  - El log solo decía `sanitized server error`, sin ningún dato para diagnosticar.
  - La vista caía **en silencio** a la caché local del navegador. La grilla parecía editable y todo guardado fallaba.
- Cómo podía llegar ese código a Production sin 0043:
  - El build sigue adelante si Neon responde 402 (cuota).
  - O si la reconciliación **rechaza** una migración salteada por orden de merge: solo deja un aviso y el deploy continúa.

## 3. Corrección (sin migraciones, sin write-back, sin tocar datos)

1. **Versión desactualizada (A):**
   - `GET /api/v1/version` devuelve el commit desplegado.
   - La app lo compara con el suyo al volver a la pestaña y cada 5 minutos, y muestra «Hay una nueva versión… Actualizar ahora», que recarga. Si hay una operación en curso, espera a que termine.
   - `GET /api/v1/asignacion-lotes` también devuelve `build`. Si difiere del de la pestaña, Asignación de lotes muestra «Recargar ahora» y la grilla queda en solo lectura **con ese motivo** en lugar de fallar.
2. **Esquema pendiente (B):**
   - Los errores de Postgres «columna/tabla inexistente» (42703/42P01) ya no terminan en un 500 genérico:
     - `/api/v1/asignacion-lotes*` responde **503 `ASIGNACION_LOTES_SCHEMA_PENDING`** con el mensaje «falta la migración 0043» y la lista de objetos faltantes.
     - Las demás rutas responden 503 `SCHEMA_PENDING`.
   - El log registra el SQLSTATE, sin SQL ni datos.
   - La pantalla muestra el motivo real y deja la caché en solo lectura, en vez de simular que se puede editar.
3. **El build ya no publica código sin el esquema que necesita:**
   - Después de `migrate()` y de la reconciliación, `verifyRequiredSchema` comprueba los objetos de 0043 leyendo `information_schema`.
   - En Production, si falta alguno, **corta el build** y se conserva el deploy anterior. En Preview solo avisa.
4. **Diagnóstico sin tocar datos:** `/api/v1/env-check` agrega `build` y `asignacionLotesLocalEdits: { ready, missing, migration }`.
5. **`GenusGrid`:** acepta `readOnlyReason`. Antes, toda grilla de solo lectura decía «Tu sector no puede editar esta tabla», aunque el motivo fuera otro.

## 4. Cómo confirmarlo en Production después del merge (solo lectura)

1. Abrir `https://appgenus.vercel.app/api/v1/env-check`:
   - `build` tiene que ser el commit del merge;
   - `asignacionLotesLocalEdits.ready` tiene que ser `true`.
2. Si `ready` es `false`, el build no se publica (corta en el paso 3). Revisar el log del build en Vercel (`[db:migrate] FALTAN objetos…`). No hace falta ninguna migración manual: se aplica en el build.
3. Cualquier pestaña o tablet con GENUS abierto desde antes verá «Hay una nueva versión» y se actualiza con un toque.

## 5. Validación

- **E2E nuevo, en configuración equivalente a Production** (`npm run test:e2e:asignacion-lotes-production`, desde `frontend/`): **30/30**.
  - Configuración: `next build` + `next start`, `NODE_ENV=production`, `VERCEL_ENV=production` simulado (write-back apagado), modo de datos real, Postgres descartable, Chromium con login real.
  - Filas de Google sincronizadas antes de 0043 (`source_*` nulos, como en Production):
    - Sin candados para Producción en cantidades, lote, VTO, observaciones y marca.
    - Doble clic, escribir y Enter guardan. Queda «editado en GENUS» y la auditoría con usuario y sector.
    - Al recargar se conserva 1180.
  - **Sync real** (el mismo motor `syncSource` del cron, con la planilla en memoria y sin Google):
    - Si la planilla no cambia ese dato, 1180 **se mantiene**. La marca cambiada en la planilla sí se actualiza. No se duplica ni se archiva.
    - Si la planilla cambia el mismo dato (1100), queda **conflicto visible**: celda en ámbar y panel con la decisión.
  - Pestaña con versión anterior: aviso, recargar y grilla en solo lectura con el motivo. El aviso global de la PWA también aparece.
  - Base sin 0043:
    - La pantalla dice «falta la migración 0043».
    - La API responde 503 `ASIGNACION_LOTES_SCHEMA_PENDING`.
    - `env-check` lista los faltantes.
  - Al restaurar 0043, la grilla vuelve a editar y guardar sin intervención.
  - Ninguna operación de write-back a Google.
- **E2E de #112 corrido sobre el build de producción**: 20/20. Incluye pegar desde Excel, deshacer, historial, conflicto, alta, 409 por versión vieja y permisos de Calidad, Codificado y Envasado.
- Integración contra Postgres real (`npm run test:e2e:produccion-edicion-db`): **23/23**. Incluye la suite de 0043: sync que no pisa, conflictos, identidad, concurrencia y permisos.
- Unitarios: detección 42703/42P01 (también envuelto por Drizzle), 503 en GET y PATCH, `build` en GET, `verifyRequiredSchema`, versión de pestaña vs. servidor. Área de lotes, db, orders y pwa: 503 OK.
- Capturas en `docss/img/asignacion-lotes-production/`:
  - `1` fila de Google editable para Producción;
  - `2` recarga;
  - `3` sync que mantiene la edición;
  - `4` conflicto visible;
  - `5a`/`5b` pestaña con versión anterior;
  - `6` base sin 0043.

## 6. Limitaciones

- No se pudo leer el estado real de Production (commit desplegado ni esquema de Neon): este entorno no tiene acceso a esos servicios. Las dos causas posibles quedan cubiertas y, desde este PR, se pueden distinguir con `/api/v1/env-check`.
- Si Neon responde 402 (cuota) durante el build, la migración se sigue salteando sin cortar el deploy. Eso ya estaba así y no se cambió. En ese caso la pantalla ahora lo dice («falta la migración 0043») en lugar de quedar en una caché que no guarda.
