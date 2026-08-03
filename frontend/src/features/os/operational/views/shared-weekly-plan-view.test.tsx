/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SharedWeeklyPlanView } from "./shared-weekly-plan-view";

vi.mock("../hooks/use-shared-weekly-plan", () => ({
  useSharedWeeklyPlan: () => ({
    items: [],
    uniqueCount: 0,
    loading: false,
    error: null,
    lastSuccessAt: null,
    updatedAgoLabel: "—",
    refresh: () => undefined,
    allowedSectors: ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"],
  }),
}));

vi.mock("@/features/os/shell/twin-shell", () => ({
  TwinShell: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <div data-testid="twin-shell" data-genus-twinshell="">
      <aside data-testid="os-sidebar">sidebar</aside>
      <header data-testid="os-header">{title}</header>
      <main data-testid="os-main">{children}</main>
      <footer data-testid="os-status">status</footer>
    </div>
  ),
}));

function renderInOsRoot(ui: React.ReactElement) {
  return render(<div className="design-preview-root min-h-dvh">{ui}</div>);
}

describe("SharedWeeklyPlanView layout", () => {
  afterEach(() => cleanup());

  it("monta Plan semanal dentro de .design-preview-root y TwinShell", () => {
    renderInOsRoot(<SharedWeeklyPlanView viewer="codificado" />);
    const root = document.querySelector(".design-preview-root");
    const shell = screen.getByTestId("twin-shell");
    expect(root).toBeTruthy();
    expect(root?.contains(shell)).toBe(true);
    expect(shell.querySelector("[data-testid='os-sidebar']")).toBeTruthy();
    expect(shell.querySelector("[data-testid='os-header']")?.textContent).toBe("Plan semanal");
    expect(shell.querySelector("[data-testid='os-status']")).toBeTruthy();
    const plan = shell.querySelector("[data-genus-shared-weekly-plan='codificado']");
    expect(plan).toBeTruthy();
    expect(shell.contains(plan)).toBe(true);
    expect(root?.contains(plan)).toBe(true);
    expect(screen.getByText(/no podés crear, editar, eliminar/i)).toBeTruthy();
  });

  it("también envuelve Depósito y Materias Primas", () => {
    const { rerender } = renderInOsRoot(<SharedWeeklyPlanView viewer="deposito" />);
    expect(screen.getByTestId("twin-shell").querySelector("[data-genus-shared-weekly-plan='deposito']")).toBeTruthy();
    rerender(
      <div className="design-preview-root min-h-dvh">
        <SharedWeeklyPlanView viewer="materia_prima" />
      </div>
    );
    expect(
      screen.getByTestId("twin-shell").querySelector("[data-genus-shared-weekly-plan='materia_prima']")
    ).toBeTruthy();
  });
});
