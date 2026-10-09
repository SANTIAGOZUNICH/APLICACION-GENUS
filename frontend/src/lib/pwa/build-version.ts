/**
 * Versión (commit) que ejecuta ESTA pestaña vs. la que tiene el servidor.
 *
 * Bug de Production: una pestaña o la PWA que quedó abierta desde antes de un deploy sigue corriendo el JavaScript
 * viejo (la app cambia de pantalla sin recargar). El service worker no lo detecta: su URL de registro lleva el build
 * viejo y `sw.js` no cambia entre deploys, así que `reg.update()` nunca encuentra una versión nueva. Resultado: el
 * PR #112 estaba desplegado, pero esa pestaña seguía mostrando las filas de Google bloqueadas. Comparar con
 * `/api/v1/version` permite avisar y recargar.
 */

/** Commit con el que se compiló este bundle ("" en desarrollo local). */
export function clientBuildSha(): string {
  return (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").trim();
}

/** true si ambos commits se conocen y son distintos (la pestaña quedó con una versión anterior). */
export function isBuildSkew(serverBuild: string | null | undefined, client: string = clientBuildSha()): boolean {
  const server = (serverBuild ?? "").trim();
  return Boolean(server && client && server !== client);
}

export function shortBuild(sha: string | null | undefined): string {
  return (sha ?? "").trim().slice(0, 7) || "dev";
}

/** Commit desplegado en el servidor, o null si no se pudo consultar. */
export async function fetchServerBuild(): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/version", { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const body = (await res.json()) as { build?: string };
    return typeof body.build === "string" ? body.build : null;
  } catch {
    return null;
  }
}
