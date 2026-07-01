"use client";

import type { WorkItem } from "@/types/operational/work-item";
import { Chip } from "@/components/ui/chip";
import Link from "next/link";

function WorkItemRow({ item, showPreviewMeta }: { item: WorkItem; showPreviewMeta?: boolean }) {
  const title = item.product ?? item.client ?? item.createdFrom;

  return (
    <article className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[var(--foreground)]">{title}</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {[item.client, item.quantity && item.unit ? `${item.quantity} ${item.unit}` : item.quantity, item.line]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.createdFrom}</p>
          {showPreviewMeta && (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              origen: {item.source} · stage: {item.originStage}
              {item.pedidoRef ? ` · pedido: ${item.pedidoRef}` : ""}
              {item.oeRef ? ` · oe: ${item.oeRef}` : ""}
              {item.oaRef ? ` · oa: ${item.oaRef}` : ""}
              {item.loteRef ? ` · lote: ${item.loteRef}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.priority && (
            <Chip variant="outline" size="sm">
              {item.priority}
            </Chip>
          )}
          <Chip variant="outline" size="sm">
            {item.status}
          </Chip>
          <Chip variant="outline" size="sm">
            {item.confidence}
          </Chip>
        </div>
      </div>
      {item.href && item.actionLabel && (
        <div className="mt-3">
          <Link
            href={item.href}
            className="text-xs font-medium text-[var(--color-action)] hover:underline"
          >
            {item.actionLabel}
          </Link>
        </div>
      )}
    </article>
  );
}

function WorkItemSection({
  title,
  items,
  emptyLabel,
  showPreviewMeta,
}: {
  title: string;
  items: WorkItem[];
  emptyLabel: string;
  showPreviewMeta?: boolean;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Chip variant="outline" size="sm">
          {items.length}
        </Chip>
      </header>
      <div className="flex flex-col gap-3 p-4">
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <WorkItemRow key={item.id} item={item} showPreviewMeta={showPreviewMeta} />
          ))
        )}
      </div>
    </section>
  );
}

export function MiTrabajoSections({
  hoy,
  semana,
  pendientes,
  bloqueados,
  showPreviewMeta,
}: {
  hoy: WorkItem[];
  semana: WorkItem[];
  pendientes: WorkItem[];
  bloqueados: WorkItem[];
  showPreviewMeta?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <WorkItemSection title="Para hacer hoy" items={hoy} emptyLabel="Sin trabajos para hoy." showPreviewMeta={showPreviewMeta} />
      <WorkItemSection title="Esta semana" items={semana} emptyLabel="Sin trabajos esta semana." showPreviewMeta={showPreviewMeta} />
      <WorkItemSection title="Pendientes" items={pendientes} emptyLabel="Sin pendientes." showPreviewMeta={showPreviewMeta} />
      <WorkItemSection title="Bloqueados" items={bloqueados} emptyLabel="Sin bloqueos." showPreviewMeta={showPreviewMeta} />
    </div>
  );
}
