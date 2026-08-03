import { getOsDeploymentLabel } from "@/features/os/auth/lib/os-deployment-label";

/** Footer global login — información mínima sobre escena navy. */
export function OsLoginFooter() {
  const deploymentLabel = getOsDeploymentLabel();
  return (
    <footer className="flex shrink-0 flex-col gap-3 border-t border-white/10 bg-[var(--os-navy)]/80 px-6 py-4 text-[0.6875rem] text-white/55 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-12">
      <p>© 2026 Genus OS · Enterprise Edition</p>
      <p className="tabular-nums" aria-label={`${deploymentLabel} · Idioma Español`}>
        {deploymentLabel} · ES
      </p>
    </footer>
  );
}
