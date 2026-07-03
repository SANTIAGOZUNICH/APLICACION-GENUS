import type { Metadata } from "next";
import { OsSignInScreen } from "@/features/os/auth/components";

export const metadata: Metadata = {
  title: "Ingresar — Genus OS",
  description: "Inicio de sesión corporativo del Manufacturing Operating System.",
};

/** Fase 4.1 — preview UI aislada. Auth wiring en PRs 4.4–4.6. */
export default function LoginPage() {
  return (
    <div className="design-preview-root">
      <OsSignInScreen />
    </div>
  );
}
