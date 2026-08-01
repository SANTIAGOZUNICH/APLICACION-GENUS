# Genus Auth — variables de entorno (SOLO nombres, sin valores)

Ninguno de estos nombres tiene un valor asignado en este repo. Configurar
los valores reales en Vercel (Preview / Production, según corresponda) o en
`.env.local` (nunca commiteado).

## Gates de migración / seed

| Variable | Valores | Uso |
| --- | --- | --- |
| `APPLY_MIGRATION_0016` | `1` | Aplica `drizzle/0016_genus_auth.sql` en el próximo build/`db:migrate-if`. Sin esto, 0016 queda diferida. |
| `APPLY_AUTH_SEED` | `1` | Requerido para que `scripts/seed-genus-auth.mjs` haga algo (por defecto es no-op). |
| `GENUS_AUTH_SEED_FORCE_PASSWORD` | `1` | Opcional. Si está seteado, el seed sobreescribe `password_hash` de usuarios ya existentes. Sin esto, el seed es puramente aditivo (no pisa passwords). |

## Backend de autenticación

| Variable | Valores | Uso |
| --- | --- | --- |
| `GENUS_AUTH_BACKEND` | `neon` (o ausente) | `neon` = usa `DrizzleAuthRepository` sobre las tablas `genus_auth_*` (requiere 0016 aplicada). Ausente/cualquier otro valor = usa `MemoryAuthRepository` (default, no durable). |

## Comportamiento de sesión / headers de test

| Variable | Valores | Uso |
| --- | --- | --- |
| `GENUS_AUTH_ALLOW_TEST_HEADERS` | `1` | Habilita, además de `NODE_ENV=test`, que `resolveAuthenticatedActor` acepte el header legacy `x-genus-actor-email` como identidad (SOLO para harness de tests fuera de vitest, p.ej. Playwright contra Preview de test). **Nunca** setear en Production ni en Preview real de usuarios. |
| `NODE_ENV` | `test` (ya gestionado por vitest) | Cuando es `test`, habilita el mismo fallback de header que `GENUS_AUTH_ALLOW_TEST_HEADERS=1`, sin necesidad de setear nada extra en la suite de vitest. |

## Conexión a base de datos (ya existentes, reutilizadas por Genus Auth)

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Neon — usado por `getDb()` (`DrizzleAuthRepository`) y por `scripts/seed-genus-auth.mjs`. |
| `DATABASE_URL_UNPOOLED` | Preferida para migraciones/seed (conexión directa, sin pooler). |
| `POSTGRES_URL` | Fallback si las anteriores no están. |

## Passwords de seed (una por sector — SOLO nombres, nunca valores en Git)

Leídas exclusivamente por `scripts/seed-genus-auth.mjs` desde el entorno de
ejecución (Vercel envs o `.env.local` no commiteado). Nunca deben existir en
código, SQL, fixtures de test ni en este repo.

| Variable | Sector / email del directorio |
| --- | --- |
| `GENUS_AUTH_PASSWORD_ELABORACION` | `elaboracion@laboratoriogenus.com.ar` |
| `GENUS_AUTH_PASSWORD_ENVASADO_MASIVO` | `emasivo@laboratoriogenus.com.ar` |
| `GENUS_AUTH_PASSWORD_ENVASADO_PREMIUM` | `epremium@laboratoriogenus.com.ar` |
| `GENUS_AUTH_PASSWORD_CALIDAD` | `calidad@laboratoriogenus.com.ar` |
| `GENUS_AUTH_PASSWORD_PRODUCCION` | `produccion@laboratoriogenus.com.ar` |
| `GENUS_AUTH_PASSWORD_MATERIA_PRIMA` | `mp@laboratoriogenus.com.ar` |
| `GENUS_AUTH_PASSWORD_CODIFICADO` | `codificado@laboratoriogenus.com.ar` |
| `GENUS_AUTH_PASSWORD_DEPOSITO` | `deposito@laboratoriogenus.com.ar` |

## Ya existentes, usados por `cookies.ts` para decidir `Secure`

Estos ya forman parte del entorno estándar de Vercel — no son variables
nuevas de Genus Auth, solo se leen:

| Variable | Uso |
| --- | --- |
| `NODE_ENV=production` | Fuerza `Secure` en la cookie de sesión. |
| `VERCEL` | Presente en cualquier runtime de Vercel → fuerza `Secure`. |
| `VERCEL_ENV=preview` / `VERCEL_ENV=production` | Fuerza `Secure` en la cookie de sesión. |
| `GENUS_ENV=production` | Chequeado además de `VERCEL_ENV` por `scripts/seed-genus-auth.mjs` para abortar el seed. |

## Orden recomendado para activar en Preview

1. `APPLY_MIGRATION_0016=1` (solo en el entorno donde corre el build/migrate).
2. Confirmar tablas creadas (ver `tmp-mig-0016-deferred/PLAN.md`).
3. `GENUS_AUTH_BACKEND=neon`.
4. Setear las 8 `GENUS_AUTH_PASSWORD_*` (valores reales, solo en Vercel/`.env.local`).
5. `APPLY_AUTH_SEED=1` + ejecutar `npm run auth:seed` una vez.
6. Quitar/dejar `APPLY_AUTH_SEED` según se prefiera (el seed es idempotente,
   así que puede quedar seteado sin riesgo salvo que además se active
   `GENUS_AUTH_SEED_FORCE_PASSWORD=1`).
