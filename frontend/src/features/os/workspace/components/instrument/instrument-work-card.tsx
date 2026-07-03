import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { QueueCardData, QueueSectionData } from "../../experience/v2-types";
import { EntityRef } from "./entity-ref";
import { InstrumentStatusBadge } from "./status-indicator";
import { QuickAction } from "../premium/quick-action";

interface InstrumentWorkCardProps {
  item: QueueCardData;
  onAction?: (item: QueueCardData) => void;
  variant?: "queue" | "compact";
}

/** Card instrumento — lectura vertical, una acción (spec §3). */
export function InstrumentWorkCard({
  item,
  onAction,
  variant = "queue",
}: InstrumentWorkCardProps) {
  const isCompact = variant === "compact";
  const isDone = item.status === "ready" && !item.ctaLabel;

  return (
    <article
      className={`group os-fade-in flex flex-col rounded-[var(--os-radius-sm)] border bg-[var(--os-surface)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--os-shadow-sm)] ${
        isDone
          ? "border-[var(--os-border-subtle)] opacity-75"
          : "border-[var(--os-border)]"
      } ${isCompact ? "px-4 py-3.5" : "px-5 py-5 sm:px-6 sm:py-6"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <EntityRef className={isCompact ? "text-sm" : ""}>{item.reference}</EntityRef>
        <InstrumentStatusBadge status={item.status} />
      </div>

      <p
        className={`mt-3 font-semibold text-[var(--os-text)] ${
          isCompact ? "text-sm" : "text-base sm:text-lg"
        }`}
      >
        {item.product}
      </p>

      <p className="mt-2 text-sm leading-relaxed text-[var(--os-text)]">{item.workLine}</p>

      {(item.metaLine || item.ageLabel) && (
        <p className="mt-2 text-xs text-[var(--os-text-muted)] sm:text-sm">
          {item.metaLine ?? item.ageLabel}
        </p>
      )}

      {item.ctaLabel && onAction && (
        <div className="mt-5 flex justify-end sm:mt-6">
          <QuickAction
            label={item.ctaLabel}
            onClick={() => onAction(item)}
            variant="secondary"
          />
        </div>
      )}
    </article>
  );
}

interface QueueSectionBlockProps {
  section: QueueSectionData;
  onCardAction?: (item: QueueCardData) => void;
}

export function QueueSectionBlock({ section, onCardAction }: QueueSectionBlockProps) {
  const [open, setOpen] = useState(section.defaultOpen ?? true);

  if (section.items.length === 0) return null;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 py-2 text-left"
        aria-expanded={open}
      >
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
          {section.title}
        </h3>
        <ChevronDown
          className={`size-4 text-[var(--os-text-muted)] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="space-y-3 transition-opacity duration-200">
          {section.items.map((item) => (
            <InstrumentWorkCard key={item.id} item={item} onAction={onCardAction} />
          ))}
        </div>
      )}
    </section>
  );
}

interface CompletedTodayProps {
  count: number;
  label: string;
  items?: Array<{ id: string; text: string }>;
}

export function CompletedTodayCollapsible({ count, label, items = [] }: CompletedTodayProps) {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 py-2 text-sm text-[var(--os-text-muted)] transition-colors hover:text-[var(--os-text)]"
        aria-expanded={open}
      >
        <ChevronDown
          className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
        <span>
          {label} ({count})
        </span>
      </button>
      {open && items.length > 0 && (
        <ul className="mt-2 space-y-1 border-l border-[var(--os-border-subtle)] pl-4 text-sm text-[var(--os-text-muted)]">
          {items.map((item) => (
            <li key={item.id}>{item.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface ActivityRowProps {
  text: string;
  time?: string;
}

export function ActivityRow({ text, time }: ActivityRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-[var(--os-text-muted)]">{text}</span>
      {time && (
        <time className="shrink-0 tabular-nums text-xs text-[var(--os-text-muted)]">{time}</time>
      )}
    </div>
  );
}
