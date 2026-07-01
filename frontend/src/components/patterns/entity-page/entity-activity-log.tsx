import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EntityActivityLogEntry } from "@/types/entity-page";

interface EntityActivityLogProps {
  entries: readonly EntityActivityLogEntry[];
  className?: string;
}

/**
 * EntityActivityLog — definitive activity structure:
 * Hora → Usuario → Acción → Descripción
 * Prepared for future Comunicación module integration.
 */
export function EntityActivityLog({
  entries,
  className,
}: EntityActivityLogProps) {
  if (entries.length === 0) {
    return (
      <Card variant="default" padding="md" className={className}>
        <CardHeader className="p-0 pb-3">
          <CardTitle>Actividad</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <p
            className="text-[var(--muted-foreground)]"
            style={{ fontSize: "var(--text-meta)" }}
          >
            Sin actividad registrada.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="default" padding="md" className={className}>
      <CardHeader className="p-0 pb-3">
        <CardTitle>Actividad</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ol className="space-y-4">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="relative border-l-2 border-[var(--border)] pl-3"
            >
              <time
                className="block font-mono text-[var(--muted-foreground)]"
                style={{ fontSize: "var(--text-caption)" }}
                dateTime={entry.timestamp}
              >
                {entry.timestamp}
              </time>
              <p
                className="mt-1 font-medium text-[var(--foreground)]"
                style={{ fontSize: "var(--text-meta)" }}
              >
                {entry.user}
              </p>
              <p
                className="mt-0.5 font-medium text-[var(--color-action)]"
                style={{ fontSize: "var(--text-body)" }}
              >
                {entry.action}
              </p>
              <p
                className="mt-1 text-[var(--muted-foreground)]"
                style={{ fontSize: "var(--text-meta)" }}
              >
                {entry.description}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
