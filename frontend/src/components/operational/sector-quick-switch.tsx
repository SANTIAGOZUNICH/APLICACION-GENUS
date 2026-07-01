"use client";

import { PREVIEW_SECTOR_QUICK_LINKS } from "@/config/sector-preview";
import { SECTOR_LABELS, type CurrentSectorId } from "@/types/operational/sector";
import { useCurrentSector } from "@/lib/operational/current-sector-context";
import { cn } from "@/lib/utils/cn";

/** Quick sector switch for F8.1 functional preview validation. */
export function SectorQuickSwitch() {
  const { sector, setSector } = useCurrentSector();

  return (
    <div className="flex flex-wrap gap-2">
      {PREVIEW_SECTOR_QUICK_LINKS.map((option) => {
        const active = sector === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => setSector(option as CurrentSectorId)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-[var(--color-action)] bg-[var(--color-action)]/10 text-[var(--foreground)]"
                : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] hover:border-[var(--border-subtle)] hover:text-[var(--foreground)]"
            )}
          >
            {SECTOR_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
