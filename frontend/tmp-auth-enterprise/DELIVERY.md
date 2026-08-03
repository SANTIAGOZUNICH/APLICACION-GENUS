# Entrega — Genus Session Auth (PR #60 / Preview)

## Confirmaciones

- merge = false
- Production = false
- 0014 no aplicada
- 0015 no aplicada
- fórmulas Preview = 842 versiones / 784 vigentes
- sin contraseñas demo ni secretos nuevos en `src/` / Git staged
- SHA: **`344c46d`**

## Sistema

**Genus Session Auth** (propio): bcryptjs + cookie HttpOnly `genus_session` + Neon 0016.
Vars `NEON_AUTH_*` existían en Vercel sin código de app → no se instaló un segundo sistema.

## Preview

- Deployment Ready (commit `344c46d`):  
  https://aplicacion-genus-9e0h3ww1g-santizunich-2879s-projects.vercel.app
- Alias de rama:  
  https://aplicacion-genus-git-claude-g-024097-santizunich-2879s-projects.vercel.app
- Smoke HTTP 8/8 sectores: `preview-http-smoke.json` (`ok: true`)
- Dry-run 0016: `../tmp-mig-0016-dryrun/report.json`
- Capturas:
  - PC: `screenshots/auth-login-pc.png`
  - iPhone 390×844: `screenshots/auth-login-iphone-390.png` (si falta, la del navigate móvil quedó en el historial del browser agent)
- Matriz permisos: `PERMISSIONS_MATRIX.md`
- Arquitectura: `ARCHITECTURE.md`
- Env names: `ENV_NAMES.md`

## Variables (solo nombres)

`APPLY_MIGRATION_0016`, `APPLY_AUTH_SEED`, `GENUS_AUTH_BACKEND`, `GENUS_AUTH_SEED_FORCE_PASSWORD`,
`GENUS_AUTH_ALLOW_TEST_HEADERS`, `GENUS_AUTH_PASSWORD_ELABORACION`,
`GENUS_AUTH_PASSWORD_ENVASADO_MASIVO`, `GENUS_AUTH_PASSWORD_ENVASADO_PREMIUM`,
`GENUS_AUTH_PASSWORD_CALIDAD`, `GENUS_AUTH_PASSWORD_PRODUCCION`,
`GENUS_AUTH_PASSWORD_MATERIA_PRIMA`, `GENUS_AUTH_PASSWORD_CODIFICADO`,
`GENUS_AUTH_PASSWORD_DEPOSITO`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`

En Preview, backend Neon se autoactiva con `VERCEL_ENV=preview` + `DATABASE_URL`
(salvo `GENUS_AUTH_BACKEND=memory`).

## Cuentas sembradas (Preview)

| Email (oculto) | Sector | Status |
| --- | --- | --- |
| e***@laboratoriogenus.com.ar | ELABORACION | ACTIVO |
| e***@laboratoriogenus.com.ar | ENVASADO_MASIVO | ACTIVO |
| e***@laboratoriogenus.com.ar | ENVASADO_PREMIUM | ACTIVO |
| c***@laboratoriogenus.com.ar | CALIDAD | ACTIVO |
| p***@laboratoriogenus.com.ar | PRODUCCION | ACTIVO |
| m***@laboratoriogenus.com.ar | MATERIA_PRIMA | ACTIVO |
| c***@laboratoriogenus.com.ar | CODIFICADO | ACTIVO |
| d***@laboratoriogenus.com.ar | DEPOSITO | ACTIVO |

**Rotar contraseñas antes de Production** (las demo históricas se consideran conocidas).

## Sesión

TTL **12 h** · HttpOnly · Secure en Vercel · SameSite=Lax · logout invalida DB+cookie ·
SESSION_EXPIRED auditado.

## Tests

- Vitest auth/Creamy/orders actor: 78 passed (suite enfocada).
- HTTP Preview latest: login / me / forged header 401 / sector mismatch 403 /
  logout / reuse 401 / API sin sesión 401 — 8 sectores.
- Banner login: “sesión empresarial · cookie HttpOnly” (sin copy mock).

## Alcance cerrado

No se inició auditoría móvil general ni PWA. Auth empresarial Preview completa.
