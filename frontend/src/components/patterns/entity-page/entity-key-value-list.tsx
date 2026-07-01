import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { EntityKeyValueItem } from "@/types/entity-page";

interface EntityKeyValueListProps {
  items: readonly EntityKeyValueItem[];
  columns?: 1 | 2;
  className?: string;
}

/** EntityKeyValueList — label/value pairs with optional entity links. */
export function EntityKeyValueList({
  items,
  columns = 2,
  className,
}: EntityKeyValueListProps) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3",
        columns === 2 && "sm:grid-cols-2",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.id} className="min-w-0">
          <dt
            className="text-[var(--muted-foreground)]"
            style={{ fontSize: "var(--text-caption)" }}
          >
            {item.label}
          </dt>
          <dd
            className="mt-0.5 font-medium text-[var(--foreground)]"
            style={{ fontSize: "var(--text-body)" }}
          >
            {item.href ? (
              <Link
                href={item.href}
                className="text-[var(--color-action)] hover:underline"
              >
                {item.value}
              </Link>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
