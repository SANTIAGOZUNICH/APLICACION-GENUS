/**
 * Surface label for login chrome. Derived from the real Vercel/runtime env —
 * never hardcode PRODUCTION on Preview/local.
 */
export type OsDeploymentEnv = "production" | "preview" | "local";

export function resolveOsDeploymentEnv(
  vercelEnv: string | undefined | null = process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.VERCEL_ENV
): OsDeploymentEnv {
  const normalized = String(vercelEnv ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "production") return "production";
  if (normalized === "preview") return "preview";
  return "local";
}

/** Official badge text, e.g. `V 1.0 · PRODUCTION`. */
export function getOsDeploymentLabel(
  vercelEnv?: string | null
): `V 1.0 · ${"PRODUCTION" | "PREVIEW" | "LOCAL"}` {
  const env = resolveOsDeploymentEnv(vercelEnv);
  if (env === "production") return "V 1.0 · PRODUCTION";
  if (env === "preview") return "V 1.0 · PREVIEW";
  return "V 1.0 · LOCAL";
}
