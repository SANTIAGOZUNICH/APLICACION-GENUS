# 42 — Seguridad, aislamiento del Preview y validación con servicios reales (PR #109)

Estado al 2026-10-08. Complementa `docss/40` §6–§7 y `docss/41`. **El PR #109 no está listo para producción** hasta completar §5.
Todo lo de este documento se revisó **sin leer ni descifrar secretos**: solo nombres de variables, metadatos de Vercel y código.

## 1. `GENUS_AUTH_ALLOW_TEST_HEADERS` (bypass de autenticación)

**Qué es:** con valor `1`, un request sin sesión válida puede identificarse como **cualquier cuenta del directorio** enviando
el header `x-genus-actor-email` (`src/lib/auth/resolve-authenticated-actor.ts`). El middleware solo exige que *exista* una
cookie `genus_session` (no la valida), así que el bypass es explotable desde afuera. El diseño original lo prohibía en Production.

**Estado en Vercel:** la variable existe **solo en Production** (tipo *sensitive*, creada el 2026-08-02). Su valor no se puede leer,
y la red de este entorno no llega a `appgenus.vercel.app`, así que **no se pudo comprobar si hoy está activa**. Hay que tratarla como activa.

**Corrección en código (este PR):** `isTestHeaderModeEnabled()` devuelve `false` en **cualquier deploy de Vercel**
(Production y Preview: `VERCEL`/`VERCEL_ENV` definidos) y con `GENUS_ENV=production`, **independientemente de la variable**
y de `NODE_ENV`. Solo vitest y harness locales pueden usar el header. Tests en `resolve-authenticated-actor.test.ts`
(Production/Preview + variable → 401; la cookie sigue funcionando). `/api/v1/env-check` expone `authTestHeaderMode` (debe dar `false`).
**Llega a Production recién con el merge a `main`.**

**Estado al 2026-10-08 21:49 UTC (verificado en Vercel, sin leer valores):**
- La variable **ya no está en Production**, pero **no se eliminó: se cambió a Preview** (editada 21:41 UTC). Si vale `1`, el bypass
  pasó a los deploys de Preview hasta que este PR los redeploye con el código nuevo. **Recomendado: eliminarla también de Preview.**
- Redeploy de Production `dpl_GziieH48…` (commit `1d31f76`, `main`) creado 21:42 y **READY** 21:44 en `appgenus.vercel.app`:
  se construyó sin la variable.
- **No verificado en vivo:** la red de este entorno no llega a `appgenus.vercel.app` y desde el redeploy no hubo tráfico en los logs.

**Verificación en vivo (desde tu navegador/terminal):**
1. Bypass: `curl -s -o /dev/null -w "%{http_code}\n" -H "cookie: genus_session=x" -H "x-genus-actor-email: produccion@laboratoriogenus.com.ar" https://appgenus.vercel.app/api/v1/auth/me` → **401**. (`/auth/me` solo lee la identidad.)
2. Login normal: entrar con un usuario real en `https://appgenus.vercel.app/login` y navegar. El frontend sigue enviando el header, pero con sesión válida se ignora.

## 2. Aislamiento de Preview vs Production (Neon)

Comprobado con los metadatos de la integración Neon de Vercel (sin leer conexiones):

| | Production | Preview |
|---|---|---|
| Recurso Neon (Vercel store) | `genus-os-production` (`store_5dTA…`) | `genus-os-native-previewww` (`store_Ex4L…`) |
| Proyecto Neon | `patient-queen-37992197` | `morning-tooth-45402181` |
| Entornos conectados | solo `production` | solo `preview` (con rama Neon por deploy, acción obligatoria) |
| `DATABASE_URL` sale de | ese recurso | ese recurso |

**Son dos proyectos Neon distintos**: una edición en el Preview no puede llegar a la base de Production.
Confirmación en runtime (recomendada antes de pruebas de escritura): logueado, `https://<preview>/api/v1/env-check` → anotar
`databaseFingerprint`; cuando este PR llegue a Production, comparar con el de Production (deben diferir).

Otros hallazgos: la `DATABASE_URL` de Production es de tipo *encrypted* (Vercel la marca `readable-secret`); conviene pasarla a
*sensitive* cuando se rote. Las credenciales de Google son compartidas Preview+Production: el Preview **lee** las planillas reales.

## 3. Escrituras en Google: nunca sobre las originales

- El write-back está **apagado** en todos los entornos (`ASIGNACION_LOTES_WRITEBACK`, `SEMANAS_WRITEBACK` y allowlists no existen) y
  bloqueado por código en Production.
- **Nuevo en este PR:** `src/lib/google/protected-spreadsheets.ts`. Asignación nunca escribe en las dos planillas oficiales (2025/2026)
  aunque estén en la allowlist; Semanas nunca escribe en la SEMANAS 2026 indexada en Drive (si no puede averiguarlo, **no escribe**).
  `GENUS_PROTECTED_SPREADSHEET_IDS` agrega otros ids protegidos. Tests en `protected-spreadsheets.test.ts` y `semanas-sheet-service.test.ts`.
- El cron (`/api/cron/asignacion-lotes-sync`) **solo lee** Google: sync con `sheetsReader` y reconciliación que solo relee celdas.

## 4. Pruebas reales — preparadas, ejecutalas con tus credenciales

Todas corren **en tu máquina**, nunca en Vercel, y se saltan solas si falta alguna variable. Desde `frontend/`, con `npm ci`.

### 4.1 Rama Neon descartable `it-pr109` (sin copiar datos personales de más)
1. **Pruebas funcionales (4.2–4.5):** Neon Console → proyecto **`morning-tooth-45402181`** (el de Preview, sin datos productivos) →
   Branches → **New branch** `it-pr109`. Las pruebas importan sus propios datos (desde las copias o con usuarios `it-*`/`e2e-*`).
2. **Dry-run de migraciones (opcional, antes del merge):** rama `it-pr109-migr` desde **`patient-queen-37992197`** (Production),
   correr solo `DATABASE_URL=<rama> DATABASE_URL_UNPOOLED=<rama> node scripts/migrate-if-database.mjs` (desde `frontend/`)
   y **borrar la rama enseguida**. Contiene copia de datos reales: no exportar nada ni correr las otras pruebas ahí.
3. Copiar la conexión **directa** (sin `-pooler`) a una variable local: `export IT_DB='postgres://…'` (no pegarla en el chat ni en el repo).
4. Huella de Production para la barrera anti-error (no expone la conexión; pooled o directa dan lo mismo):
   `read -s GENUS_FP_URL && export GENUS_FP_URL && export IT_PROD_FP=$(npx tsx scripts/it/db-fingerprint.ts) && unset GENUS_FP_URL` (desde `frontend/`, pegando la `DATABASE_URL` de Production sin que se vea)
   o, después del merge, el `databaseFingerprint` de `/api/v1/env-check` en Production.

### 4.2 Neon real (migraciones, persistencia, concurrencia)
`GENUS_IT_CONFIRM_DISPOSABLE_DB=yes GENUS_IT_DATABASE_URL="$IT_DB" npx vitest run src/integration/neon.integration.test.ts`

### 4.3 Cron de sincronización (Google solo lectura → rama descartable)
`GENUS_IT_CRON_CONFIRM=yes GENUS_IT_CONFIRM_DISPOSABLE_DB=yes GENUS_IT_DATABASE_URL="$IT_DB" GENUS_IT_PRODUCTION_DB_FINGERPRINT="$IT_PROD_FP" GOOGLE_SERVICE_ACCOUNT_EMAIL=… GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=… npx vitest run src/integration/cron-sync.integration.test.ts`
Verifica: 401 sin secreto, 2 fuentes oficiales sincronizadas, segunda corrida sin duplicados, **cero intentos de escritura en Google**.
Se niega si la base tiene la huella de Production.

### 4.4 Sincronización bidireccional sobre copias (Asignación 2026 + SEMANAS 2026)
1. File → Make a copy de *Asignación de Lotes 2026* y *SEMANAS 2026*, con «copia» o «test» en el título; compartirlas como **Editor**
   con la cuenta de servicio. Elegir una pestaña de la copia de Asignación con columna OBSERVACIONES.
2. Suite completa (`src/integration/sync-bidirectional.integration.test.ts`):
   `GENUS_IT_GOOGLE_CONFIRM_COPIES=yes GENUS_IT_GOOGLE_ASIGNACION_COPY_ID=<copia> GENUS_IT_GOOGLE_ASIGNACION_TAB=<pestaña> GENUS_IT_GOOGLE_SEMANAS_COPY_ID=<copia> GENUS_IT_CONFIRM_DISPOSABLE_DB=yes GENUS_IT_DATABASE_URL="$IT_DB" GENUS_IT_PRODUCTION_DB_FINGERPRINT="$IT_PROD_FP" GOOGLE_SERVICE_ACCOUNT_EMAIL=… GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=… GOOGLE_DRIVE_GENUS_FOLDER_ID=… npx vitest run src/integration/sync-bidirectional.integration.test.ts`

| Verificación | Asignación 2026 (copia) | SEMANAS 2026 (copia) |
|---|---|---|
| Google → GENUS | sync de la copia a la rama; un cambio hecho en Google llega en el siguiente sync | la vista lee la copia en vivo, incluido un cambio hecho en Google |
| GENUS → Google | editar en GENUS escribe en la copia y en la base | escribe solo esa celda |
| Conflictos | cambio externo → `GOOGLE_CONFLICT`, no pisa | cambio externo → no escribe |
| Auditoría | `asignacion_lotes_cell_audit` con valor anterior/nuevo/usuario | `sheet_cell_edits` con valor anterior/nuevo/usuario |
| Fórmulas | celda con fórmula → rechazada, fórmula intacta | combinadas y fórmulas de la pestaña idénticas |
| Duplicados | segundo sync: 0 creados, sin duplicados por identidad | escritura repetida → idempotente |

   Se niega si un id es una original protegida, si el título no dice copia/test o si la base es la de Production.
   Restaura cada celda tocada (incluidas fórmulas) al terminar.
3. La prueba anterior más chica sigue disponible: `src/integration/google-copy.integration.test.ts`.

### 4.5 E2E de Plan semanal contra Neon real (opcional)
En la rama `it-pr109`: `create database genus_e2e;` y `GENUS_E2E_DATABASE_URL=<conexión a genus_e2e> GENUS_E2E_ALLOW_REMOTE_DB=yes npm run test:e2e:plan-semanal`.

### 4.6 Al terminar
Borrar la rama `it-pr109` en Neon. Revisar el historial de versiones de las planillas originales: no debe haber cambios de la cuenta de servicio.

## 5. Habilitar la sincronización bidireccional en Production (pendiente de tu decisión)
Hoy el write-back está **bloqueado por código en Production** (`VERCEL_ENV=production`), sin importar flags. Para que se pueda
habilitar cuando aprueben el sistema, la propuesta es una política única (`src/lib/google/protected-spreadsheets.ts`):
- apagado por defecto (flag del módulo + allowlist);
- fuera de Production: solo copias, nunca las originales;
- en Production: flag + allowlist + aprobación explícita `GENUS_GOOGLE_WRITEBACK_PRODUCTION=approved`; con eso escribe en las originales.
  Quitar esa variable y redeployar es el interruptor de apagado; `/api/v1/env-check` muestra el estado.
**No se aplicó:** el cambio que quita el bloqueo fijo de Production fue frenado por el control de seguridad del entorno de desarrollo y
requiere tu confirmación explícita. Hasta entonces Production no puede escribir en Google (seguro, pero no habilitable sin un cambio de código).

## 6. Para aprobar el merge
- [ ] §1: variable eliminada de Production **y de Preview** + redeploy + `curl` → 401 + login normal OK.
- [ ] §4.2 Neon real en verde (incluye dry-run de migraciones sobre copia de Production).
- [ ] §4.3 Cron real en verde.
- [ ] §4.4 sincronización bidireccional con copias en verde, originales sin cambios.
- [ ] §5 decisión sobre cómo habilitar el write-back en Production.
- [ ] (Opcional) prueba manual en el Preview con write-back apuntando **solo** a copias (flags solo en entorno Preview; borrarlas al terminar).
- [ ] CI verde y revisión humana del PR. Tras el merge: `/api/v1/env-check` en Production con `authTestHeaderMode: false` y huella distinta del Preview.
