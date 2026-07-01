"use client";

import { SECTOR_LABELS, type CurrentSectorId } from "@/types/operational/sector";
import { useCurrentSector } from "@/lib/operational/current-sector-context";

/** F8.1 — temporary sector selector (pre-login infrastructure). */
export function SectorSelector() {
  const { sector, setSector, options } = useCurrentSector();

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <label htmlFor="current-sector" className="text-xs font-medium text-[var(--muted-foreground)]">
        Sector temporal (sin login)
      </label>
      <select
        id="current-sector"
        value={sector}
        onChange={(event) => setSector(event.target.value as CurrentSectorId)}
        className="mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {SECTOR_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
