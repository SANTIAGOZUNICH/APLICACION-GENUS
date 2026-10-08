# 42 — Seguridad, aislamiento del Preview y validación con servicios reales (PR #109)

Estado al 2026-10-08. Complementa `docss/40` §6–§7 y `docss/41`. **El PR #109 no está listo para producción** hasta completar §5.
Todo lo de este documento se revisó **sin leer ni descifrar secretos**: solo nombres de variables, metadatos de Vercel y código.

## 1. `GENUS_AUTH_ALLOW_TEST_HEADERS` (bypass de autenticación)

**Qué es:** con valor `1`, un request sin sesión válida puede identificarse como **cualquier cuenta del directorio** enviando
el header `x-genus-actor-email` (`src/lib/auth/resolve-authenticated-actor.ts`). El middleware solo exige que *exista* una
cookie `genus_session` (no la valida), así que el bypass es explotable desde afuera. El diseño original lo prohibía en Production.

**Estado en Vercel:** la variable existe **solo en Production** (tipo *sensitive*, creada el 2026-08-02). Su valor no se puede leer,
y la red de este entorno no llega a `appgenus.vercel.app`, así que **no se pudo comprobar si hoy está activa**. Hay que tratarla como activa.

**Corrección en código (este PR):** `isTestHeaderModeEnabled()` devuelve `false` siempre que `VERCEL_ENV=production` o
`GENUS_ENV=production`, **independientemente de la variable** (y de `NODE_ENV`). En Production la identidad sale solo de la cookie.
Tests: `resolve-authenticated-actor.test.ts` (Production + variable → 401; la cookie sigue funcionando). `/api/v1/env-check`
expone `authTestHeaderMode` (debe dar `false` en Preview y Production). **Protege Production recién cuando llegue a `main`.**

**Cómo desactivarla ya, sin tocar usuarios, sesiones ni datos** (no depende del merge):
1. Vercel → proyecto `aplicacion-genus` → Settings → Environment Variables → filtrar `GENUS_AUTH_ALLOW_TEST_HEADERS` → entorno **Production** → ⋯ → **Remove**.
2. Deployments → el último de Production (hoy `dpl_FNjDCaJX…`, commit `1d31f76`) → ⋯ → **Redeploy** (las variables se toman al desplegar; quitar una variable sin redeploy no surte efecto).
   El redeploy reconstruye el mismo commit de `main`: no cambia código, no corre migraciones nuevas (las de `main` ya están aplicadas), no cierra sesiones.
3. Verificación (desde tu navegador o terminal):
   `curl -s -o /dev/null -w "%{http_code}\n" -H "cookie: genus_session=x" -H "x-genus-actor-email: produccion@laboratoriogenus.com.ar" https://appgenus.vercel.app/api/v1/auth/me`
   → debe dar **401**. (`/auth/me` solo lee la identidad; no crea sesiones ni modifica nada.) Si da **200**, el bypass sigue activo.
4. El frontend sigue mandando ese header en sus llamadas, pero con sesión válida se ignora: quitar la variable no rompe nada para usuarios logueados.

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

### 4.1 Rama Neon descartable
1. Neon Console → proyecto **`patient-queen-37992197`** (Production) → Branches → **New branch** `it-pr109` desde `main` (copia con datos: sirve como dry-run real de migraciones).
2. Copiar la conexión **directa** (sin `-pooler`) de esa rama a una variable local: `export IT_DB='postgres://…'` (no la pegues en el chat ni en el repo).
3. Huella de Production para la barrera anti-error: `export IT_PROD_FP=$(node -e "const c=require('crypto');const u=new URL(process.argv[1]);console.log(c.createHash('sha256').update(u.hostname.toLowerCase()+'/'+u.pathname.replace(/^\//,'')).digest('hex').slice(0,12))" '<DATABASE_URL de Production>')`
   (o el `databaseFingerprint` de `/api/v1/env-check` de Production cuando llegue este PR).

### 4.2 Neon real (migraciones, persistencia, concurrencia)
`GENUS_IT_CONFIRM_DISPOSABLE_DB=yes GENUS_IT_DATABASE_URL="$IT_DB" npx vitest run src/integration/neon.integration.test.ts`

### 4.3 Cron de sincronización (Google solo lectura → rama descartable)
`GENUS_IT_CRON_CONFIRM=yes GENUS_IT_CONFIRM_DISPOSABLE_DB=yes GENUS_IT_DATABASE_URL="$IT_DB" GENUS_IT_PRODUCTION_DB_FINGERPRINT="$IT_PROD_FP" GOOGLE_SERVICE_ACCOUNT_EMAIL=… GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=… npx vitest run src/integration/cron-sync.integration.test.ts`
Verifica: 401 sin secreto, 2 fuentes oficiales sincronizadas, segunda corrida sin duplicados, **cero intentos de escritura en Google**.
Se niega si la base tiene la huella de Production.

### 4.4 Copias de Google Sheets
1. File → Make a copy de *Asignación de Lotes 2026* y *SEMANAS 2026*, con «copia» o «test» en el título; compartir como **Editor** con la cuenta de servicio.
2. `GENUS_IT_GOOGLE_CONFIRM_COPIES=yes GENUS_IT_GOOGLE_SEMANAS_COPY_ID=<copia> GENUS_IT_GOOGLE_ASIGNACION_COPY_ID=<copia> GENUS_IT_GOOGLE_ASIGNACION_TAB=<pestaña> GOOGLE_SERVICE_ACCOUNT_EMAIL=… GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=… GOOGLE_DRIVE_GENUS_FOLDER_ID=… npx vitest run src/integration/google-copy.integration.test.ts`
   Se niega si el id es una original protegida o si el título no dice copia/test; revierte cada celda y compara valores, combinadas y fórmulas.
   `GOOGLE_DRIVE_GENUS_FOLDER_ID` hace falta para que Semanas confirme que la copia **no** es la original indexada.

### 4.5 E2E de Plan semanal contra Neon real (opcional)
En la rama `it-pr109`: `create database genus_e2e;` y `GENUS_E2E_DATABASE_URL=<conexión a genus_e2e> GENUS_E2E_ALLOW_REMOTE_DB=yes npm run test:e2e:plan-semanal`.

### 4.6 Al terminar
Borrar la rama `it-pr109` en Neon. Revisar el historial de versiones de las planillas originales: no debe haber cambios de la cuenta de servicio.

## 5. Para aprobar el merge
- [ ] §1: variable eliminada de Production + redeploy + `curl` → 401.
- [ ] §4.2 Neon real en verde (incluye dry-run de migraciones sobre copia de Production).
- [ ] §4.3 Cron real en verde.
- [ ] §4.4 Google con copias en verde, originales sin cambios.
- [ ] (Opcional) prueba manual en el Preview con write-back apuntando **solo** a copias (flags solo en entorno Preview; borrarlas al terminar).
- [ ] CI verde y revisión humana del PR. Tras el merge: `/api/v1/env-check` en Production con `authTestHeaderMode: false` y huella distinta del Preview.
