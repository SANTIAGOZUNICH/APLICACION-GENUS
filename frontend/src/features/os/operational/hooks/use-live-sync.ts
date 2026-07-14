"use client";

import { useEffect, useRef, useState } from "react";
import type { SectorId } from "@/types/operational/sector";
import {
  connectLiveSyncStream,
  fetchLiveSyncCheck,
  fetchLiveSyncStatus,
  formatUpdatedAgo,
  secondsSince,
} from "@/lib/api/live-sync-client";
import { createLiveSyncPollController } from "@/lib/live-sync/live-sync-poll-controller";
import type { LiveSyncEvent } from "@/lib/live-sync/types";

interface UseLiveSyncOptions {
  sector: SectorId;
  enabled?: boolean;
  date?: string | null;
  weekStart?: string | null;
  onUpdate?: () => void;
}

interface UseLiveSyncResult {
  connected: boolean;
  updatedAt: string | null;
  updatedAgoLabel: string;
  revision: number;
}

/**
 * Live Sync:
 * - Polling liviano /check cada 3s → garantía Sheets → app
 * - SSE → operaciones Genus OS → otros usuarios
 */
export function useLiveSync(options: UseLiveSyncOptions): UseLiveSyncResult {
  const { sector, enabled = true, date = null, weekStart = null, onUpdate } = options;
  const [connected, setConnected] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [tick, setTick] = useState(0);
  const onUpdateRef = useRef(onUpdate);
  const dateRef = useRef(date);
  const weekStartRef = useRef(weekStart);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    dateRef.current = date;
    weekStartRef.current = weekStart;
  }, [date, weekStart]);

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

    const poll = createLiveSyncPollController({
      isVisible: () =>
        typeof document === "undefined" || document.visibilityState !== "hidden",
      check: async (knownVersion, signal) => {
        const result = await fetchLiveSyncCheck({
          sector,
          knownVersion,
          date: dateRef.current,
          weekStart: weekStartRef.current,
          signal,
        });
        return {
          changed: result.changed,
          version: result.version,
          revision: result.revision,
          checkedAt: result.checkedAt,
        };
      },
      onChanged: (result) => {
        if (result.revision != null) setRevision(result.revision);
        setUpdatedAt(result.checkedAt);
        onUpdateRef.current?.();
      },
    });

    poll.start();

    const onVisibility = () => poll.onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibility);

    const ticker = window.setInterval(() => setTick((v) => v + 1), 1000);

    return () => {
      poll.stop();
      document.removeEventListener("visibilitychange", onVisibility);
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
