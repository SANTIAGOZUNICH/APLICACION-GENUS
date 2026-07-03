"use client";

import type { OperationalActivityEntry } from "../types";
import { WORK_TRANSFER } from "../lib/work-transfer-labels";

interface OperationalActivityFeedProps {
  entries: OperationalActivityEntry[];
  title?: string;
}

/** Flujo de planta — transferencias entre sectores, sin popups. */
export function OperationalActivityFeed({
  entries,
  title = WORK_TRANSFER.recentFlowTitle,
}: OperationalActivityFeedProps) {
  if (entries.length === 0) {
    return (
      <p className="rounded-[var(--os-radius-sm)] border border-dashed border-[var(--os-border)] px-4 py-3 text-sm text-[var(--os-text-muted)]">
        Sin transferencias registradas aún.
      </p>
    );
  }

  return (
    <section className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)]">
      <header className="border-b border-[var(--os-border-subtle)] px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--os-text-muted)]">
          {title}
        </h3>
      </header>
      <ul className="divide-y divide-[var(--os-border-subtle)]">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <ActivityDot type={entry.type} />
            <span className="flex-1 text-[var(--os-text)]">{entry.message}</span>
            <span className="text-xs text-[var(--os-text-muted)]">
              {entry.actor} · {formatActivityTime(entry.at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityDot({ type }: { type: OperationalActivityEntry["type"] }) {
  const cls =
    type === "transfer"
      ? "bg-[var(--os-teal)]"
      : type === "quality_approve"
        ? "bg-emerald-500"
        : "bg-rose-500";

  return (
    <span
      className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${cls}`}
      aria-hidden="true"
    />
  );
}

function formatActivityTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
