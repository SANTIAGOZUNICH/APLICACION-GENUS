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

/**
 * Dominio canónico por-deployment en Preview.
 *
 * Bug real (2026-08-12, "Sesión vencida" constante en PR #74 Preview):
 * Vercel expone SIEMPRE dos hostnames válidos para el mismo deployment de
 * Preview — el propio, único por build (VERCEL_URL, ej.
 * aplicacion-genus-p3rf1lm04-<team>.vercel.app) y el alias de rama, estable
 * entre pushes (VERCEL_BRANCH_URL / el link que postea el check de GitHub,
 * ej. aplicacion-genus-git-<branch>-<team>.vercel.app). Confirmado contra
 * la API de Vercel (get_deployment) para el deployment real de este PR:
 * ambos hostnames resuelven al mismo build. La cookie de sesión es
 * host-only (ver cookies.ts) — si el login ocurre en un hostname y una
 * navegación/pestaña posterior usa el otro (link distinto, pestaña vieja,
 * bookmark), esa request llega sin cookie y el middleware (que solo
 * verifica presencia) responde 401/redirect como sesión vencida, aunque la
 * sesión siga siendo válida en el otro hostname. Mismo patrón que el bug de
 * Production (ver comentario arriba), pero Preview no tenía ninguna
 * protección análoga.
 *
 * Fix: redirect 308 al hostname propio del deployment (VERCEL_URL — always
 * on para cualquier deployment de Vercel, a diferencia de VERCEL_BRANCH_URL
 * que puede faltar) ANTES de toda otra lógica, solo en Preview y solo para
 * páginas (mismo criterio que el canónico de Production: las fetches de la
 * SPA son same-origin relativas, así que alcanza con canonicalizar la
 * navegación de página).
 */
export interface PreviewCanonicalHostCheckInput {
  vercelEnv: string | undefined;
  hostname: string;
  isApiRequest: boolean;
  deploymentHost: string | undefined;
}

export function shouldRedirectToCanonicalPreviewHost(
  input: PreviewCanonicalHostCheckInput
): boolean {
  if (input.vercelEnv !== "preview") return false;
  if (input.isApiRequest) return false;
  const deploymentHost = input.deploymentHost?.trim();
  if (!deploymentHost) return false;
  return input.hostname !== deploymentHost;
}
