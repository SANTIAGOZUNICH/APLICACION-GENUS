import type { Metadata } from "next";
import { OsSignInScreen } from "@/features/os/auth/components";

export const metadata: Metadata = {
  title: "Ingresar — Genus OS",
  description: "Vista previa de acceso al Manufacturing Operating System.",
};

/** Access Preview — credenciales mock internas; sin auth real. */
export default function LoginPage() {
  return (
    <div className="design-preview-root">
      <OsSignInScreen accessPreview />
    </div>
  );
}
