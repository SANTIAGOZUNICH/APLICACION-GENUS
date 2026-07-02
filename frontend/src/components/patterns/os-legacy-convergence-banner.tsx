"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isLegacyOsBannerEnabled,
  LEGACY_WORKSPACE_PREFIXES,
} from "@/lib/config/os-convergence";

function isLegacyWorkspacePath(pathname: string): boolean {
  return LEGACY_WORKSPACE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** Banner opt-in en Track A — guía hacia rutas OS productivas sin romper legacy. */
export function OsLegacyConvergenceBanner() {
  const pathname = usePathname();

  if (!isLegacyOsBannerEnabled() || !isLegacyWorkspacePath(pathname)) {
    return null;
  }

  return (
    <div
      role="status"
      className="border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5 text-sm text-[var(--foreground)]"
    >
      <p className="mx-auto max-w-5xl">
        <span className="font-medium">Genus OS — nueva experiencia disponible.</span>{" "}
        Podés probar{" "}
        <Link href="/mi-trabajo" className="font-medium text-[var(--primary)] underline-offset-2 hover:underline">
          Mi Trabajo
        </Link>
        ,{" "}
        <Link href="/plan-semanal" className="font-medium text-[var(--primary)] underline-offset-2 hover:underline">
          Plan semanal
        </Link>{" "}
        y{" "}
        <Link href="/consulta" className="font-medium text-[var(--primary)] underline-offset-2 hover:underline">
          Consulta
        </Link>
        . Este workspace legacy sigue operativo.
      </p>
    </div>
  );
}
