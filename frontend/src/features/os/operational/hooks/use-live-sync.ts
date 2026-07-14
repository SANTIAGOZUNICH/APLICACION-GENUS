"use client";

import { useEffect, useRef, useState } from "react";
import type { SectorId } from "@/types/operational/sector";
import type { WorkItem } from "@/types/operational/work-item";
import {
  connectLiveSyncStream,
  fetchLiveSyncCheck,
  fetchLiveSyncStatus,
  formatUpdatedAgo,
  secondsSince,
  type LiveSyncCheckResponse,
} from "@/lib/api/live-sync-client";
import { createLiveSyncPollController } from "@/lib/live-sync/live-sync-poll-controller";
import { shouldAcceptLiveSyncUpdate } from "@/lib/live-sync/live-sync-version";
import type { LiveSyncEvent } from "@/lib/live-sync/types";
import { getClientPlanningSource } from "@/lib/planning/planning-source";

export interface LiveSyncSheetUpdate {
  version: string;
  revision: number;
  checkedAt: string;
  workItems: WorkItem[];
  counts?: LiveSyncCheckResponse["counts"];
}

interface UseLiveSyncOptions {
  sector: SectorId;
  enabled?: boolean;
  ownerPerson?: string | null;
  date?: string | null;
  weekStart?: string | null;
  /** Ops Genus OS (SSE) — puede refetch; NO usar para Sheet→app. */
  onOperationalEvent?: () => void;
  /** Sheet cambió — aplicar WorkItems del /check (sin GET /work-items). */
  onSheetUpdate?: (update: LiveSyncSheetUpdate) => void;
}

interface UseLiveSyncResult {
  connected: boolean;
  updatedAt: string | null;
  updatedAgoLabel: string;
  revision: number;
  semanasVersion: string | null;
}

/**
 * Live Sync:
 * - Polling /check cada 3s → garantía Sheets → app (payload autoritativo)
 * - SSE → operaciones Genus OS → otros usuarios
 */
export function useLiveSync(options: UseLiveSyncOptions): UseLiveSyncResult {
  const {
    sector,
    enabled = true,
    ownerPerson = null,
    date = null,
    weekStart = null,
    onOperationalEvent,
    onSheetUpdate,
  } = options;

  const [connected, setConnected] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [semanasVersion, setSemanasVersion] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const onOperationalEventRef = useRef(onOperationalEvent);
  const onSheetUpdateRef = useRef(onSheetUpdate);
  const dateRef = useRef(date);
  const weekStartRef = useRef(weekStart);
  const ownerPersonRef = useRef(ownerPerson);
  const appliedRevisionRef = useRef<number | null>(null);
  const appliedVersionRef = useRef<string | null>(null);

  useEffect(() => {
    onOperationalEventRef.current = onOperationalEvent;
  }, [onOperationalEvent]);

  useEffect(() => {
    onSheetUpdateRef.current = onSheetUpdate;
  }, [onSheetUpdate]);

  useEffect(() => {
    dateRef.current = date;
    weekStartRef.current = weekStart;
    ownerPersonRef.current = ownerPerson;
  }, [date, weekStart, ownerPerson]);

  useEffect(() => {
    if (!enabled) return;

    // Planificación nativa: no mezclar con Sheets /live-sync/check.
    const nativePlanning = getClientPlanningSource() === "native";

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

        // snapshot.updated desde otra instancia puede ser stale — no refetch WorkItems.
        if (event.type === "heartbeat" || event.type === "snapshot.updated") {
          return;
        }

        // Ops Genus OS → otros usuarios
        onOperationalEventRef.current?.();
      },
      () => setConnected(false)
    );

    if (nativePlanning) {
      setConnected(true);
      return () => {
        disconnect();
      };
    }

    const poll = createLiveSyncPollController({
      isVisible: () =>
        typeof document === "undefined" || document.visibilityState !== "hidden",
      check: async (knownVersion, signal) => {
        const result = await fetchLiveSyncCheck({
          sector,
          knownVersion,
          ownerPerson: ownerPersonRef.current,
          date: dateRef.current,
          weekStart: weekStartRef.current,
          signal,
        });
        return {
          changed: result.changed,
          version: result.version,
          revision: result.revision,
          checkedAt: result.checkedAt,
          workItems: result.workItems,
          counts: result.counts,
        };
      },
      onChanged: (result) => {
        const incomingRevision = result.revision ?? 0;
        const accept = shouldAcceptLiveSyncUpdate({
          appliedRevision: appliedRevisionRef.current,
          appliedVersion: appliedVersionRef.current,
          incomingRevision,
          incomingVersion: result.version,
        });

        if (!accept) return;

        const items = (result.workItems as WorkItem[] | undefined) ?? null;
        if (!items) return;

        appliedRevisionRef.current = incomingRevision;
        appliedVersionRef.current = result.version;
        setRevision(incomingRevision);
        setSemanasVersion(result.version);
        setUpdatedAt(result.checkedAt);

        onSheetUpdateRef.current?.({
          version: result.version,
          revision: incomingRevision,
          checkedAt: result.checkedAt,
          workItems: items,
          counts: result.counts as LiveSyncSheetUpdate["counts"],
        });
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

  return {
    connected,
    updatedAt,
    updatedAgoLabel,
    revision,
    semanasVersion,
  };
}
