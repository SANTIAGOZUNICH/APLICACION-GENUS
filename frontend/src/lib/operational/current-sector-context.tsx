"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CURRENT_SECTOR_STORAGE_KEY,
  DEFAULT_CURRENT_SECTOR,
} from "@/config/current-sector";
import {
  CURRENT_SECTOR_OPTIONS,
  SECTOR_GREETING,
  type CurrentSectorId,
} from "@/types/operational/sector";

interface CurrentSectorContextValue {
  sector: CurrentSectorId;
  setSector: (sector: CurrentSectorId) => void;
  greeting: string;
  options: readonly CurrentSectorId[];
}

const CurrentSectorContext = createContext<CurrentSectorContextValue | null>(null);

function readStoredSector(): CurrentSectorId {
  if (typeof window === "undefined") return DEFAULT_CURRENT_SECTOR;
  const stored = window.localStorage.getItem(CURRENT_SECTOR_STORAGE_KEY);
  if (stored && CURRENT_SECTOR_OPTIONS.includes(stored as CurrentSectorId)) {
    return stored as CurrentSectorId;
  }
  return DEFAULT_CURRENT_SECTOR;
}

/** F8.1 — temporary sector selection until Login (doc 22). */
export function CurrentSectorProvider({ children }: { children: ReactNode }) {
  const [sector, setSectorState] = useState<CurrentSectorId>(() => {
    if (typeof window === "undefined") return DEFAULT_CURRENT_SECTOR;
    return readStoredSector();
  });

  const setSector = useCallback((next: CurrentSectorId) => {
    setSectorState(next);
    window.localStorage.setItem(CURRENT_SECTOR_STORAGE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({
      sector,
      setSector,
      greeting: SECTOR_GREETING[sector],
      options: CURRENT_SECTOR_OPTIONS,
    }),
    [sector, setSector]
  );

  return (
    <CurrentSectorContext.Provider value={value}>
      {children}
    </CurrentSectorContext.Provider>
  );
}

export function useCurrentSector(): CurrentSectorContextValue {
  const ctx = useContext(CurrentSectorContext);
  if (!ctx) {
    throw new Error("useCurrentSector must be used within CurrentSectorProvider");
  }
  return ctx;
}
