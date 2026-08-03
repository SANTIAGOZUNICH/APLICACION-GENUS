/**
 * Nombres de header — módulo client-safe (sin "server-only", sin
 * dependencias de Node/DB). Existe para que componentes de cliente puedan
 * seguir armando estos headers en sus llamadas `fetch` sin arrastrar al
 * bundle del navegador el árbol de módulos server-only de Genus Auth
 * (bcryptjs, node:crypto, drizzle, etc.) que cuelga de
 * `resolveAuthenticatedActor`.
 *
 * En Preview real la identidad SIEMPRE viene de la cookie de sesión
 * (`genus_session`, HttpOnly); estos headers solo tienen efecto como
 * fuente de identidad en modo test (`NODE_ENV==='test'` o
 * `GENUS_AUTH_ALLOW_TEST_HEADERS==='1'`). Fuera de ese modo el runtime los
 * IGNORA por completo — ver src/lib/auth/resolve-authenticated-actor.ts.
 */
export const ACTOR_EMAIL_HEADER = "x-genus-actor-email";
export const ACTOR_SECTOR_HEADER = "x-genus-actor-sector";
