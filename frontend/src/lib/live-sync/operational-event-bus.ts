import "server-only";

import type { LiveSyncEvent } from "@/lib/live-sync/types";

type Subscriber = (event: LiveSyncEvent) => void;

/** Pub/sub in-process — empuja eventos a conexiones SSE activas. */
class OperationalEventBus {
  private subscribers = new Set<Subscriber>();

  subscribe(handler: Subscriber): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  publish(event: LiveSyncEvent): void {
    for (const handler of this.subscribers) {
      try {
        handler(event);
      } catch {
        // no bloquear otros suscriptores
      }
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

export const operationalEventBus = new OperationalEventBus();
