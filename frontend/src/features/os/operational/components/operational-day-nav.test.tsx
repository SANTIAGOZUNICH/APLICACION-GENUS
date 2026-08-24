/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalDayNav } from "./operational-day-nav";

afterEach(() => {
  cleanup();
});

/**
 * Bloque 3/6 — flechas exactamente ±1 semana en modo Semana (nunca ±1 día,
 * nunca cambian de modo), y "Semana actual" para volver rápido sin resetear
 * a vista Día.
 */
describe("OperationalDayNav — modo Semana", () => {
  const baseProps = {
    selectedDate: "2026-08-25",
    today: "2026-08-24",
  };

  it("flecha derecha llama onNextWeek (no onNext) y nunca cambia de modo", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onNextWeek = vi.fn();
    const onPrev = vi.fn();
    const onPrevWeek = vi.fn();
    const onViewMode = vi.fn();
    render(
      <OperationalDayNav
        {...baseProps}
        viewMode="week"
        onPrev={onPrev}
        onNext={onNext}
        onPrevWeek={onPrevWeek}
        onNextWeek={onNextWeek}
        onToday={vi.fn()}
        onViewMode={onViewMode}
      />
    );
    await user.click(screen.getByRole("button", { name: "Semana siguiente" }));
    expect(onNextWeek).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
    expect(onViewMode).not.toHaveBeenCalled();
  });

  it("flecha izquierda llama onPrevWeek (no onPrev) y nunca cambia de modo", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onPrevWeek = vi.fn();
    const onViewMode = vi.fn();
    render(
      <OperationalDayNav
        {...baseProps}
        viewMode="week"
        onPrev={onPrev}
        onNext={vi.fn()}
        onPrevWeek={onPrevWeek}
        onNextWeek={vi.fn()}
        onToday={vi.fn()}
        onViewMode={onViewMode}
      />
    );
    await user.click(screen.getByRole("button", { name: "Semana anterior" }));
    expect(onPrevWeek).toHaveBeenCalledTimes(1);
    expect(onPrev).not.toHaveBeenCalled();
    expect(onViewMode).not.toHaveBeenCalled();
  });

  it("botón central dice 'Semana actual' en modo Semana y llama onTodayWeek, no onToday", async () => {
    const user = userEvent.setup();
    const onToday = vi.fn();
    const onTodayWeek = vi.fn();
    render(
      <OperationalDayNav
        {...baseProps}
        viewMode="week"
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onPrevWeek={vi.fn()}
        onNextWeek={vi.fn()}
        onToday={onToday}
        onTodayWeek={onTodayWeek}
        onViewMode={vi.fn()}
      />
    );
    const btn = screen.getByRole("button", { name: "Semana actual" });
    await user.click(btn);
    expect(onTodayWeek).toHaveBeenCalledTimes(1);
    expect(onToday).not.toHaveBeenCalled();
  });

  it("sin onTodayWeek, 'Semana actual' cae a onToday (compatibilidad hacia atrás)", async () => {
    const user = userEvent.setup();
    const onToday = vi.fn();
    render(
      <OperationalDayNav
        {...baseProps}
        viewMode="week"
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onPrevWeek={vi.fn()}
        onNextWeek={vi.fn()}
        onToday={onToday}
        onViewMode={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "Semana actual" }));
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it("muestra el rango de semana con claridad: 'Semana DD/M – DD/M'", () => {
    render(
      <OperationalDayNav
        {...baseProps}
        selectedDate="2026-08-25"
        viewMode="week"
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onPrevWeek={vi.fn()}
        onNextWeek={vi.fn()}
        onToday={vi.fn()}
        onViewMode={vi.fn()}
      />
    );
    expect(screen.getByText("Semana 24/8 – 30/8")).toBeTruthy();
  });

  it("modo Día: las flechas siguen llamando onPrev/onNext (±1 día) sin cambios", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onNextWeek = vi.fn();
    render(
      <OperationalDayNav
        {...baseProps}
        viewMode="day"
        onPrev={vi.fn()}
        onNext={onNext}
        onPrevWeek={onNextWeek}
        onNextWeek={onNextWeek}
        onToday={vi.fn()}
        onViewMode={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: "Día siguiente" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
