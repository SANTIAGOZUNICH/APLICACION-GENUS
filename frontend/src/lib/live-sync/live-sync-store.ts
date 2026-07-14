import "server-only";

import type { CriticalSheetKey } from "@/lib/adapters/drive/drive-folder-config";
import type { LiveSyncSnapshot } from "@/lib/live-sync/types";

/** Cache de WorkItems resueltos — lectura caliente sin re-parsear. */
class LiveSyncStore {
  private snapshot: LiveSyncSnapshot | null = null;
  private sheetModifiedTimes = new Map<CriticalSheetKey, string>();
  private syncInFlight: Promise<LiveSyncSnapshot | null> | null = null;

  getSnapshot(): LiveSyncSnapshot | null {
    return this.snapshot;
  }

  isReady(): boolean {
    return this.snapshot !== null && this.snapshot.workItems.length > 0;
  }

  setSnapshot(snapshot: LiveSyncSnapshot): void {
    this.snapshot = snapshot;
  }

  getSheetModifiedTime(key: CriticalSheetKey): string | undefined {
    return this.sheetModifiedTimes.get(key);
  }

  setSheetModifiedTime(key: CriticalSheetKey, modifiedTime: string): void {
    this.sheetModifiedTimes.set(key, modifiedTime);
  }

  getSyncInFlight(): Promise<LiveSyncSnapshot | null> | null {
    return this.syncInFlight;
  }

  setSyncInFlight(promise: Promise<LiveSyncSnapshot | null> | null): void {
    this.syncInFlight = promise;
  }

  bumpRevision(): number {
    if (!this.snapshot) return 0;
    this.snapshot = {
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    return this.snapshot.revision;
  }

  /** Solo tests. */
  resetForTests(): void {
    this.snapshot = null;
    this.sheetModifiedTimes.clear();
    this.syncInFlight = null;
  }
}

export const liveSyncStore = new LiveSyncStore();
