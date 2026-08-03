/**
 * Coordinador de operaciones sucias / en progreso.
 * Bloquea actualización automática del SW cuando hay riesgo de pérdida.
 */

type GuardKind = "form-dirty" | "upload" | "remito" | "label" | "critical";

type GuardEntry = { id: string; kind: GuardKind; label?: string };

const guards = new Map<string, GuardEntry>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function beginOperationGuard(kind: GuardKind, label?: string): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  guards.set(id, { id, kind, label });
  notify();
  return id;
}

export function endOperationGuard(id: string): void {
  if (!guards.has(id)) return;
  guards.delete(id);
  notify();
}

export function hasBlockingOperations(): boolean {
  return guards.size > 0;
}

export function listBlockingOperations(): GuardEntry[] {
  return [...guards.values()];
}

export function subscribeOperationGuards(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hook-friendly snapshot. */
export function getOperationGuardSnapshot(): { blocking: boolean; items: GuardEntry[] } {
  return { blocking: guards.size > 0, items: listBlockingOperations() };
}
