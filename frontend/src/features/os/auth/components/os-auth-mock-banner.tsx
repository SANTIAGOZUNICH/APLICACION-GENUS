import { resolveOsDeploymentEnv } from "@/features/os/auth/lib/os-deployment-label";

/** Banner de contexto de acceso — texto alineado al entorno real. */
export function OsAuthMockBanner() {
  const env = resolveOsDeploymentEnv();
  const label =
    env === "production"
      ? "Acceso Production · sesión empresarial · cookie HttpOnly"
      : env === "preview"
        ? "Vista previa de acceso · sesión empresarial · cookie HttpOnly"
        : "Acceso local · sesión empresarial · cookie HttpOnly";
  return (
    <div
      role="status"
      className="border-b border-white/10 bg-[var(--os-navy)]/70 px-4 py-2 text-center text-[0.6875rem] tracking-wide text-white/70 backdrop-blur-sm"
    >
      {label}
    </div>
  );
}
