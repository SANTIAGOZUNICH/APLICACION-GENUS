import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EntityPageNotFoundProps {
  entityLabel: string;
  entityId: string;
}

export function EntityPageNotFound({
  entityLabel,
  entityId,
}: EntityPageNotFoundProps) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-[var(--sidebar-item-active-bg)]">
        <SearchX
          className="size-6 text-[var(--color-action)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>
      <h1
        className="mb-2 font-semibold text-[var(--foreground)]"
        style={{ fontSize: "var(--text-section)" }}
      >
        {entityLabel} no encontrada
      </h1>
      <p
        className="mb-6 text-[var(--muted-foreground)]"
        style={{ fontSize: "var(--text-body)" }}
      >
        No hay datos mock para <span className="font-mono">{entityId}</span>.
      </p>
      <Button variant="primary" asChild>
        <Link href="/bandeja">Volver a Mi Trabajo</Link>
      </Button>
    </div>
  );
}
