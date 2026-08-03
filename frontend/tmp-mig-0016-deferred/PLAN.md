# Migración 0016 — Genus Auth (sesiones enterprise) — PLAN (diferida)

Estado: **APLICADA EN PREVIEW** (2026-08-01) tras dry-run en rama
descartable Neon. Gate: `APPLY_MIGRATION_0016=1` (ver
`scripts/migrate-if-database.mjs`, mismo patrón que 0005…0015).
Production: **no tocada**. 0014/0015: **no aplicadas** en este trabajo.

## Qué crea

Archivo: `drizzle/0016_genus_auth.sql` (aditivo, `IF NOT EXISTS`, sin
DROP/TRUNCATE).

1. **`genus_auth_users`** — un usuario por sector (u otros roles futuros).
   - `id uuid PK`, `email` / `email_normalized` (ambos `UNIQUE NOT NULL`),
     `display_name`, `sector`, `role_id`, `role_label`, `sector_label`,
     `job_title`, `status` (default `'ACTIVO'`), `password_hash`
     (bcrypt, cost 12 — **nunca texto plano**), `redirect_to`
     (default `/mi-trabajo`), `created_at`, `updated_at`, `last_login_at`.
   - Índice en `email_normalized`.
2. **`genus_auth_sessions`** — sesiones opacas.
   - `id uuid PK`, `user_id` (FK → `genus_auth_users.id`), `token_hash`
     (`sha256(token)`, `UNIQUE NOT NULL` — el token en claro nunca se
     persiste), `expires_at`, `created_at`, `revoked_at`, `user_agent`,
     `ip_hash`.
   - Índices en `token_hash`, `user_id`, `expires_at`.
3. **`genus_auth_audit_events`** — auditoría de sesión.
   - `id uuid PK`, `event_type` (`LOGIN_OK` | `LOGIN_FAIL` | `LOGOUT` |
     `BLOCKED`), `email_normalized`, `user_id`, `detail jsonb`,
     `created_at`.
   - Índices en `email_normalized`, `user_id`.

## Por qué está diferida

- Mismo patrón que 0005–0015: el equipo aplica migraciones de Preview
  manualmente, con un flag explícito, para no arriesgar builds/back-fills
  no revisados.
- Hasta que se aplique, `src/lib/auth` usa `MemoryAuthRepository` (Map en
  memoria de proceso), igual que Creamy usa `MemoryCreamyMemoryRepository`
  hasta 0015. Ver `src/lib/auth/get-auth-service.ts`.
- No toca `formula_bank`, ni las migraciones 0004 (fórmulas), 0014
  (Codificado / Depósito Graneles) ni 0015 (Creamy memoria).

## Cómo aplicar (cuando se autorice)

1. Confirmar que `DATABASE_URL` / `DATABASE_URL_UNPOOLED` apunta al Neon
   de Preview correcto (nunca Production sin aprobación explícita).
2. Setear `APPLY_MIGRATION_0016=1` en el entorno donde corra
   `scripts/migrate-if-database.mjs` (build de Preview o ejecución manual
   de `npm run db:migrate-if`).
3. Verificar que las tablas se crearon:
   ```sql
   select to_regclass('public.genus_auth_users');
   select to_regclass('public.genus_auth_sessions');
   select to_regclass('public.genus_auth_audit_events');
   ```
4. Setear `GENUS_AUTH_BACKEND=neon` para que
   `src/lib/auth/get-auth-service.ts` use el repositorio Drizzle en vez de
   memoria.
5. Ejecutar el seed (ver `scripts/seed-genus-auth.mjs` y
   `tmp-auth-enterprise/ENV_NAMES.md` para las variables de contraseña
   requeridas). Requiere `APPLY_AUTH_SEED=1` y `DATABASE_URL`. Aborta si
   `VERCEL_ENV=production` o `GENUS_ENV=production`.
6. Smoke test: `POST /api/v1/auth/login` con un usuario sectorial real →
   debe devolver `Set-Cookie: genus_session=...` y `200` con el `user`
   (sin password). `GET /api/v1/auth/me` con esa cookie → 200. Sin cookie
   → 401 (headers de test **ignorados** salvo `NODE_ENV=test` o
   `GENUS_AUTH_ALLOW_TEST_HEADERS=1`).

## Rollback

Ver `tmp-mig-0016-deferred/ROLLBACK.md`.

## No hecho en este cambio (a propósito)

- No se aplicó la migración.
- No se tocaron 0014, 0015 ni nada de fórmulas.
- No se commiteó ningún password en texto plano (ni en SQL, ni en seeds,
  ni en `SECTOR_ACCOUNT_DIRECTORY`).
- No se modificó el login de la UI (lo hace el equipo por separado).
- No se modificó Creamy UI.
