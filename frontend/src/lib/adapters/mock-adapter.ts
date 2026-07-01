import { seedOperationsState } from "@/lib/operations/seed-operations-state";
import type { OperationsAdapter } from "@/lib/adapters/operations-adapter";

/** Demo adapter — seeds OperationsState from static E3–E6 mocks. */
export class MockAdapter implements OperationsAdapter {
  readonly mode = "demo" as const;

  getInitialState() {
    return seedOperationsState();
  }
}

export const mockAdapter = new MockAdapter();
