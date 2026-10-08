# 42 — Preview de Vercel y validación con servicios reales (PR #109)

Estado al 2026-10-08. Complementa `docss/40` §6–§7 (configuración y pruebas preparadas) y `docss/41` (estado por módulo).
**El PR #109 no está listo para producción** hasta completar §2–§4.

## 1. Revisión del Preview (solo lectura, sin descifrar secretos)

Deploy revisado: `dpl_5o8evg9Jgj8py66r4uEjmwr2dawv` (rama `claude/charming-einstein-3olrhs`, commit `2de552a`), estado READY.
Se revisaron **nombres y entornos** de las 80 variables del proyecto (los valores son *sensitive* y no se leyeron) y el código
que las usa. El endpoint `/api/v1/env-check` del Preview no se pudo consultar (pide login de la app → 401).

| Tema | Hallazgo | ¿Seguro editar en Preview? |
|---|---|---|
| Write-back a Google | `ASIGNACION_LOTES_WRITEBACK`, `SEMANAS_WRITEBACK` y sus allowlists **no existen** en ningún entorno → apagado. Además el código lo bloquea siempre con `VERCEL_ENV=production`. | ✅ No escribe en Google |
| Lectura de Google | `GOOGLE_SERVICE_ACCOUNT_*` y `GOOGLE_DRIVE_*_FOLDER_ID` son **compartidas** Preview+Production; las planillas oficiales de Asignación están fijas en el código. El Preview **lee las planillas productivas** (solo lectura). | ✅ Solo lectura |
| Base de datos | `DATABASE_URL`, `PG*`, `POSTGRES_*` están cargadas **por separado** en Preview y en Production, pero **no se pudo confirmar** que el Preview apunte a una rama de prueba y no a la base productiva. | ⚠️ **No confirmado: no editar** hasta verificarlo (§1.1) |
| Cron de sync | Vercel ejecuta crons solo en Production. | ✅ El Preview no sincroniza solo |
| Login | `GENUS_AUTH_*` solo en Production; el Preview usa auth en Neon si su base tiene la migración 0016. | — |
| ⚠️ Seguridad | `GENUS_AUTH_ALLOW_TEST_HEADERS` está definida en **Production**. Si vale `1`, un request sin sesión válida puede identificarse como **cualquier cuenta del directorio** solo enviando el header `x-genus-actor-email` (`src/lib/auth/resolve-authenticated-actor.ts`). | Revisar/eliminar en Production (§1.2) |

### 1.1 Cómo confirmar que el Preview usa una base de prueba (antes de editar nada)
Este PR agrega a `/api/v1/env-check` `databaseFingerprint` (12 hex, sha256 de host+base, no reversible) y `googleWriteback`.
1. Logueado, abrir `https://<preview>/api/v1/env-check` y anotar `databaseFingerprint`, `vercelEnv` (= `preview`) y `googleWriteback` (flags en `false`, allowlists en `0`).
2. Hacer lo mismo en Production **cuando este commit llegue a Production** (hasta entonces no expone la huella). Alternativa inmediata: Neon Console → comparar el *endpoint/host* (`ep-…`) de la rama del Preview con el de Production.
3. **Las huellas deben ser distintas.** Si son iguales, el Preview escribe en la base productiva: no editar y cargar una rama de prueba en Preview (`docss/40` §6.3).

### 1.2 `GENUS_AUTH_ALLOW_TEST_HEADERS` en Production
No se modificó (fuera del alcance del PR). Recomendación: Vercel → Settings → Environment Variables → eliminarla de Production
(o confirmar que su valor no es `1`) y redeployar. El código solo la necesita en tests locales.

## 2. Google Sheets real — pasos que faltan
1. Crear **copias de prueba** (File → Make a copy) de *Asignación de Lotes 2025*, *2026* y *SEMANAS 2026*, con «copia» o «test» en el título; compartir como **Editor** con `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
2. Prueba de integración contra las copias (local, sin Vercel):
   `GENUS_IT_GOOGLE_CONFIRM_COPIES=yes GENUS_IT_GOOGLE_SEMANAS_COPY_ID=… GENUS_IT_GOOGLE_ASIGNACION_COPY_ID=… GENUS_IT_GOOGLE_ASIGNACION_TAB=… npx vitest run src/integration/google-copy.integration.test.ts`
   (se niega si el título no dice copia/test; revierte cada celda y compara valores, combinadas y fórmulas).
3. Solo en el entorno **Preview** de Vercel (nunca Production): `ASIGNACION_LOTES_WRITEBACK=1`, `ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS=<ids de las copias>`, `SEMANAS_WRITEBACK=1`, `SEMANAS_WRITEBACK_SPREADSHEET_IDS=<id copia>`, `SEMANAS_SHEET_ID=<id copia>`; apuntar la fuente de Asignación del Preview a la copia. Confirmar en `/api/v1/env-check` que `googleWriteback` muestra flags `true` y allowlists `>0` **solo en Preview**.
4. En el Preview, con base de prueba confirmada (§1.1): editar en Asignación y en Semanas (ELABORACION, ACONDICIONAMIENTO, C/DIA, ENTREGAS) y verificar en la copia: celda correcta, sin romper combinadas/fórmulas, conflicto si alguien cambia la celda en Google al mismo tiempo, estado pendiente/error visible, reconciliación Google↔Neon.
5. Verificar que las planillas **productivas** no cambiaron (historial de versiones de Google).
6. Al terminar, borrar las flags del Preview.

## 3. Neon real — pasos que faltan
1. Crear una **rama Neon descartable** desde Production (Neon Console → Branches → New branch) y copiar su conexión **directa** (sin `-pooler`).
2. Integración de servicio: `GENUS_IT_CONFIRM_DISPOSABLE_DB=yes GENUS_IT_DATABASE_URL=<rama> npx vitest run src/integration/neon.integration.test.ts` (migraciones con el script real ×2, reaplicación de migración saltada, persistencia, auditoría, concurrencia, DUPLICATE).
3. E2E de Plan semanal contra Neon real: en la rama descartable crear una base **vacía** (`create database genus_e2e;`), y correr
   `GENUS_E2E_DATABASE_URL=<conexión a esa base> GENUS_E2E_ALLOW_REMOTE_DB=yes npm run test:e2e:plan-semanal`
   (el setup crea la marca solo porque la base está vacía; nunca acepta una base con datos). **Aún no ejecutado contra Neon.**
4. Preview con la rama: cargar su conexión **solo en Preview** como `DATABASE_URL`/`DATABASE_URL_UNPOOLED`, redeployar (el build migra hasta `0040`), confirmar la huella (§1.1) y repetir a mano los flujos de edición por celda (Pedidos, trabajos, Depósito, ME/MP, Control MP, Plan semanal) con dos usuarios a la vez.
5. Antes del merge: dry-run de migraciones contra una rama copiada de Production (el script `migrate-if-database.mjs` sobre la rama) y revisar tiempos/bloqueos de `0040`.

## 4. Para aprobar el merge
- [ ] §1.1 huella del Preview distinta de Production.
- [ ] §1.2 `GENUS_AUTH_ALLOW_TEST_HEADERS` revisada en Production.
- [ ] §2 Google: integración con copias + prueba manual en Preview, sin cambios en las planillas productivas.
- [ ] §3 Neon: integración en rama descartable + dry-run de migraciones sobre copia de Production.
- [ ] Cron de sync de Asignación verificado en un entorno real (Preview no corre crons: probar el endpoint a mano con `CRON_SECRET`).
- [ ] CI verde y revisión humana del PR.
- [ ] Plan de rollback: las flags de write-back quedan apagadas en Production por código; la migración `0040` es aditiva.
