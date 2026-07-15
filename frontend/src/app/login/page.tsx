import type { Metadata } from "next";
import { OsLoginGate } from "@/features/os/auth/components/os-login-gate";

export const metadata: Metadata = {
  title: "Ingresar — Genus OS",
  description: "Acceso al sistema operativo de Laboratorio Genus.",
};

export default function LoginPage() {
  return (
    <div className="design-preview-root">
      <OsLoginGate />
    </div>
  );
}
