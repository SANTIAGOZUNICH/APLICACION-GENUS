import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { operationalEventBus } from "@/lib/live-sync/operational-event-bus";
import { liveSyncEngine } from "@/lib/live-sync/live-sync-engine";
import type { SectorId } from "@/types/operational/sector";
import type { LiveSyncEvent } from "@/lib/live-sync/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE — actualizaciones en tiempo real sin polling. */
export async function GET(request: Request) {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json(
      { error: "Live Sync requiere GENUS_DATA_MODE=real.", code: "LIVE_SYNC_UNAVAILABLE" },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const sectorParam = url.searchParams.get("sector")?.trim().toUpperCase() || null;
  const sector = sectorParam as SectorId | null;

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: LiveSyncEvent) => {
        if (closed) return;
        if (event.type !== "snapshot.updated" && event.type !== "heartbeat" && sector) {
          if (!event.notifySectors.includes(sector)) return;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const unsubscribe = operationalEventBus.subscribe(send);

      const status = liveSyncEngine.getStatus();
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "heartbeat",
            revision: status.revision,
            at: status.updatedAt,
          })}\n\n`
        )
      );

      heartbeat = setInterval(() => {
        if (closed) return;
        const s = liveSyncEngine.getStatus();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "heartbeat", revision: s.revision, at: s.updatedAt })}\n\n`
          )
        );
      }, 15000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
