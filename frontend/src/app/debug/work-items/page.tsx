import { notFound } from "next/navigation";
import Link from "next/link";
import { WorkItemsDebugView } from "@/components/operational/work-items-debug-view";
import { isDevEnvironment } from "@/lib/config/is-dev";

export const metadata = {
  title: "Debug · WorkItems",
};

export default function WorkItemsDebugPage() {
  if (!isDevEnvironment()) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          F8.1 · solo desarrollo
        </p>
        <h1 className="mt-1 text-xl font-semibold">Diagnóstico WorkItems</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          <Link href="/mi-trabajo" className="text-[var(--color-action)] hover:underline">
            ← Volver a Mi Trabajo (preview funcional)
          </Link>
        </p>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <WorkItemsDebugView />
      </main>
    </div>
  );
}
