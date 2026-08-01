# Genus OS — Auth empresarial (Preview)

## Arquitectura encontrada (Fase 0)

- Login visual: `os-sign-in-screen.tsx` (email + password + “Iniciar sesión”).
- Validación previa: cliente contra `MOCK_PREVIEW_USERS` (contraseñas en código).
- Sesión previa: JSON en `sessionStorage`/`localStorage` (`genus_os_auth_session`).
- APIs: identidad vía `x-genus-actor-email` (forjable desde el navegador).
- Middleware: no protegía rutas de app/API.
- Paquetes auth: ninguno instalado en uso. Había variables `NEON_AUTH_*` en Vercel
  Preview (integración Marketplace) **sin código de aplicación** que las use.
- Decisión: **no** instalar un segundo sistema (Clerk/Auth.js/Better Auth/Neon Auth
  UI). Implementar **Genus Session Auth** propia sobre Neon + bcryptjs.

## Arquitectura implementada

**Genus Session Auth** (capa propia):

1. Tablas Neon — migración **0016** (`drizzle/0016_genus_auth.sql`):
   - `genus_auth_users`
   - `genus_auth_sessions`
   - `genus_auth_audit_events`
   - Dry-run en rama descartable Neon: OK (idempotente; fórmulas 842/784).
   - Aplicada **solo en Preview**. Production no tocada. 0014/0015 no aplicadas.

2. Cookie `genus_session`:
   - HttpOnly, Secure en Vercel/Preview, SameSite=Lax, Path=/
   - Token opaco aleatorio; en DB solo `sha256(token)`
   - TTL 12 h (turno de planta); invalidación real al logout
   - Eventos: LOGIN_OK / LOGIN_FAIL / LOGOUT / BLOCKED / SESSION_EXPIRED

3. Rutas: `POST /api/v1/auth/login|logout`, `GET /api/v1/auth/me`

4. Actor: `resolveAuthenticatedActor` — cookie primero; header
   `x-genus-actor-email` **solo** si `NODE_ENV=test` o
   `GENUS_AUTH_ALLOW_TEST_HEADERS=1` (nunca Preview real).

5. UI: mismos campos/ids; `GenusAuthAdapter` → API real; sin fallback demo.
   Caché local solo presentación; `/me` revalida.

6. Middleware: sin cookie → redirect `/login` (páginas) o 401 (API),
   excepto `/login` y `POST /api/v1/auth/login`.

7. Seed: `APPLY_AUTH_SEED=1` + `GENUS_AUTH_PASSWORD_*` (solo nombres en Git).
   Idempotente; aborta en Production.

8. Backend: `GENUS_AUTH_BACKEND=neon` o auto en `VERCEL_ENV=preview` con
   `DATABASE_URL`. Override `memory` para tests locales.

## Política de sesión

- Duración máxima: **12 horas**.
- Sin “recordarme para siempre”.
- Logout invalida fila de sesión + borra cookie.
- Sesión vencida → 401 + audit SESSION_EXPIRED.

## Importante — contraseñas

Las contraseñas demo que alguna vez estuvieron en Git se consideran conocidas.
En Preview se sembraron vía secretos locales gitignored (extraídos del historial
para continuidad de validación). **Deben rotarse antes de Production.**

## Fuera de alcance

- No 0014 / 0015 / merge / Production.
- No cambiar Industrial Glass ni layout de login.
- No Google / OTP / registro público / PWA.
- Creamy: misma UX y `gemini-2.0-flash`; identidad desde sesión.
