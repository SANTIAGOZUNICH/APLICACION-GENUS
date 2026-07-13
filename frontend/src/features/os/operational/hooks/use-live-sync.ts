"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SectorId } from "@/types/operational/sector";
import {
  connectLiveSyncStream,
  fetchLiveSyncStatus,
  formatUpdatedAgo,
  secondsSince,
} from "@/lib/api/live-sync-client";
import type { LiveSyncEvent } from "@/lib/live-sync/types";

interface UseLiveSyncOptions {
  sector: SectorId;
  enabled?: boolean;
  onUpdate?: () => void;
}

interface UseLiveSyncResult {
  connected: boolean;
  updatedAt: string | null;
  updatedAgoLabel: string;
  revision: number;
}

/** Suscripción SSE — reemplaza polling periódico. */
export function useLiveSync(options: UseLiveSyncOptions): UseLiveSyncResult {
  const { sector, enabled = true, onUpdate } = options;
  const [connected, setConnected] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [tick, setTick] = useState(0);
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!enabled) return;

    void fetchLiveSyncStatus()
      .then((status) => {
        setUpdatedAt(status.updatedAt);
        setRevision(status.revision);
      })
      .catch(() => {});

    const disconnect = connectLiveSyncStream(
      sector,
      (event: LiveSyncEvent) => {
        setConnected(true);
        setUpdatedAt(event.at);
        setRevision(event.revision);
        if (event.type !== "heartbeat") {
          onUpdateRef.current?.();
        }
      },
      () => setConnected(false)
    );

    const ticker = window.setInterval(() => setTick((v) => v + 1), 1000);

    return () => {
      disconnect();
      window.clearInterval(ticker);
    };
  }, [sector, enabled]);

  useEffect(() => {
    if (tick % 30 !== 0) return;
    void fetchLiveSyncStatus()
      .then((status) => {
        setUpdatedAt(status.updatedAt);
        setRevision(status.revision);
      })
      .catch(() => {});
  }, [tick]);

  const updatedAgoLabel = formatUpdatedAgo(secondsSince(updatedAt));

  return { connected, updatedAt, updatedAgoLabel, revision };
}
