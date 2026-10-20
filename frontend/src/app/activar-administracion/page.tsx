import type { Metadata } from "next";
import { ActivarAdministracionForm } from "./activar-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Activar cuenta de Administración",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function ActivarAdministracionPage() {
  return (
    <main className="design-preview-root flex min-h-screen items-center justify-center px-4 py-8">
      <ActivarAdministracionForm />
    </main>
  );
}
