# Pruebas de integración contra servicios REALES (copias de prueba)

Estas pruebas **se saltan solas** si faltan las variables `GENUS_IT_*`. Nunca corren en CI normal ni en Production.
Ver `docss/40-writeback-google-y-semanas-grid.md` §7 para el paso a paso (qué configurar y dónde, sin compartir secretos).

| Archivo | Servicio real | Variables |
|---|---|---|
| `neon.integration.test.ts` | Rama Neon **descartable** | `GENUS_IT_DATABASE_URL` (conexión directa/unpooled), `GENUS_IT_CONFIRM_DISPOSABLE_DB=yes` |
| `plan-semanal.e2e.integration.test.ts` | Navegador real + app local + Postgres **descartable** (local) | Lo prepara todo `npm run test:e2e:plan-semanal`; ver `scripts/e2e/README.md` |
| `google-copy.integration.test.ts` | Copias de prueba de Google Sheets | `GENUS_IT_GOOGLE_SEMANAS_COPY_ID`, `GENUS_IT_GOOGLE_ASIGNACION_COPY_ID`, `GENUS_IT_GOOGLE_ASIGNACION_TAB`, `GENUS_IT_GOOGLE_CONFIRM_COPIES=yes` + credenciales de la cuenta de servicio ya configuradas (`GOOGLE_SERVICE_ACCOUNT_*`) |

Salvaguardas: la prueba de Google lee el título del spreadsheet y **se niega** si no contiene "copia", "copy", "test" o "prueba";
cada escritura se revierte al final y se compara contra una foto previa (valores, combinadas y fórmulas).
Comando: `GENUS_IT_...=... npx vitest run src/integration`.
