import Link from "next/link";
import { Factory, Package, ScanBarcode, ShieldCheck, Truck } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { entityPageHref } from "@/config/entity-pages";
import { cn } from "@/lib/utils/cn";
import { EntityPageKinds, type EntityRelatedObject } from "@/types/entity-page";

const KIND_ICONS = {
  [EntityPageKinds.OE]: Factory,
  [EntityPageKinds.OA]: Package,
  [EntityPageKinds.LOTE]: ScanBarcode,
  [EntityPageKinds.PEDIDO]: Truck,
  [EntityPageKinds.LIBERACION]: ShieldCheck,
} as const;

interface EntityRelatedObjectsProps {
  objects: readonly EntityRelatedObject[];
  className?: string;
}

/** EntityRelatedObjects — navigation cards to linked entities. */
export function EntityRelatedObjects({
  objects,
  className,
}: EntityRelatedObjectsProps) {
  if (objects.length === 0) {
    return null;
  }

  return (
    <Card variant="default" padding="md" className={className}>
      <CardHeader className="p-0 pb-3">
        <CardTitle>Relacionados</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="space-y-2">
          {objects.map((object) => {
            const Icon = KIND_ICONS[object.kind];
            const href = entityPageHref(object.kind, object.entityId);

            return (
              <li key={object.id}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] p-3",
                    "transition-colors hover:border-[var(--color-action)]/30 hover:bg-[var(--sidebar-item-hover)]"
                  )}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--sidebar-item-active-bg)]">
                    <Icon
                      className="size-4 text-[var(--color-action)]"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="font-mono text-[var(--muted-foreground)]"
                      style={{ fontSize: "var(--text-caption)" }}
                    >
                      {object.entityId}
                    </p>
                    <p
                      className="truncate font-medium text-[var(--foreground)]"
                      style={{ fontSize: "var(--text-meta)" }}
                    >
                      {object.title}
                    </p>
                    {object.subtitle && (
                      <p
                        className="truncate text-[var(--muted-foreground)]"
                        style={{ fontSize: "var(--text-caption)" }}
                      >
                        {object.subtitle}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={object.status} size="sm" />
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
