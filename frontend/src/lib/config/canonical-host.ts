/**
 * Dominio canónico único en Production.
 *
 * Bug real: el deployment de Production tiene VARIOS alias de Vercel
 * apuntando al mismo build (appgenus.vercel.app,
 * aplicacion-genus-<team>.vercel.app, aplicacion-genus-git-main-<team>
 * .vercel.app, y uno nuevo por cada deploy tipo
 * aplicacion-genus-<hash>-<team>.vercel.app). La cookie de sesión
 * (genus_session, ver src/lib/auth/cookies.ts) nunca setea `Domain=` — es
 * host-only por diseño (más segura), así que SOLO viaja de vuelta al mismo
 * hostname exacto que la puso. Si un usuario entra por un link/bookmark a
 * un alias distinto del que después usa la navegación/fetches de la app
 * (mismo deployment, otro hostname), el login devuelve 200 y setea la
 * cookie correctamente, pero cualquier request posterior en el hostname
 * "equivocado" llega sin cookie — el middleware (que solo verifica
 * presencia, ver src/middleware.ts) responde 401/redirect a /login como si
 * nunca hubiera iniciado sesión. Esto reproduce exactamente "login
 * aparentemente correcto → expulsado inmediatamente" sin ningún código
 * específico de sector de por medio.
 *
 * Fix: redirect 308 a un único host canónico ANTES de cualquier otra
 * lógica, solo en Production (nunca en Preview — cada Preview deploy tiene
 * su propio hostname único y NO debe redirigirse a Production) y solo para
 * páginas (no API — las fetches de la SPA son same-origin relativas; una
 * vez que la navegación de página aterriza en el host canónico, todo fetch
 * posterior ya sale desde ahí).
 */

export const DEFAULT_CANONICAL_PRODUCTION_HOST = "appgenus.vercel.app";

export function getCanonicalProductionHost(): string {
  return process.env.CANONICAL_HOST?.trim() || DEFAULT_CANONICAL_PRODUCTION_HOST;
}

export interface CanonicalHostCheckInput {
  vercelEnv: string | undefined;
  hostname: string;
  isApiRequest: boolean;
  canonicalHost?: string;
}

/**
 * true si esta request debe redirigirse al host canónico. Nunca en Preview
 * ni en dev local (VERCEL_ENV solo vale "production"/"preview" en Vercel;
 * indefinido en local), y nunca para rutas de API (ver comentario arriba).
 */
export function shouldRedirectToCanonicalHost(input: CanonicalHostCheckInput): boolean {
  if (input.vercelEnv !== "production") return false;
  if (input.isApiRequest) return false;
  const canonical = input.canonicalHost ?? getCanonicalProductionHost();
  return input.hostname !== canonical;
}
