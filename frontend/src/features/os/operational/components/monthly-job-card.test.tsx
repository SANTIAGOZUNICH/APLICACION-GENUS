// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { formatJobDates, formatJobQuantity, MonthlyJobCard } from "./monthly-job-card";
import type { WeeklyPlanItemDto } from "@/lib/planning/weekly-plan-dto";

const job = (over: Partial<WeeklyPlanItemDto> = {}): WeeklyPlanItemDto => ({
  workItemId: "w1", plannedDate: "2026-11-05", plannedDateTo: "2026-11-05", product: "Serum Capilar", client: "Aqualo", quantity: "2000", unit: "un.",
  sector: "ENVASADO_PREMIUM", sectorLabel: "Envasado Premium", responsible: "Línea 1", deliveryDate: null, status: "PUBLICADO", statusLabel: "Publicado", lote: null, notes: null, progressLabel: "Pendiente", stateLabel: "Pendiente", ...over,
});

const COMMENT = { id: "c1", workItemId: "w1", body: "Tenemos 1.200 unidades <b>terminadas</b>", authorName: "Ana Depósito", authorSector: "DEPOSITO", authorSectorLabel: "Depósito", createdAt: "2026-11-02T13:15:00.000Z" };

describe("MonthlyJobCard", () => {
  let posts: Array<Record<string, unknown>>;
  let stored: typeof COMMENT[];
  beforeEach(() => {
    posts = [];
    stored = [COMMENT];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const b = JSON.parse(String(init.body));
        posts.push(b);
        const c = { ...COMMENT, id: `n${posts.length}`, body: b.body };
        stored.push(c);
        return new Response(JSON.stringify({ comment: c, created: true }), { status: 201 });
      }
      return new Response(JSON.stringify({ comments: stored }), { status: 200 });
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("formatea cantidad con miles y unidad legible, y fechas", () => {
    expect(formatJobQuantity("2000", "un.")).toBe("2.000 unidades");
    expect(formatJobQuantity("2.000", "un.")).toBe("2.000 unidades");
    expect(formatJobQuantity("500", "kg")).toBe("500 kg");
    expect(formatJobQuantity("12,5", "kg")).toBe("12,5 kg");
    expect(formatJobDates("2026-11-05", "2026-11-05")).toBe("05/11/2026");
    expect(formatJobDates("2026-11-05", "2026-11-07")).toBe("05/11/2026 al 07/11/2026");
  });

  it("muestra cliente, producto y cantidad (principal) y fecha, sector y estado; sin lote si no está asignado; sin acciones", () => {
    render(<MonthlyJobCard job={job()} />);
    expect(screen.getByTestId("job-card-client").textContent).toBe("Aqualo");
    expect(screen.getByTestId("job-card-product").textContent).toBe("Serum Capilar");
    expect(screen.getByTestId("job-card-quantity").textContent).toBe("2.000 unidades");
    expect(screen.getByTestId("job-card-date").textContent).toBe("05/11/2026");
    expect(screen.getByTestId("job-card-sector").textContent).toBe("Envasado Premium");
    expect(screen.getByTestId("job-card-state").textContent).toBe("Pendiente");
    expect(screen.queryByTestId("job-card-lote")).toBeNull();
    // Único control: Publicar (comentarios). Sin acciones de asignar, editar, eliminar ni reprogramar.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Publicar"]);
  });

  it("incluye el lote solo cuando está asignado y no muestra campos vacíos", () => {
    const { rerender } = render(<MonthlyJobCard job={job({ lote: "L-26099" })} />);
    expect(screen.getByTestId("job-card-lote").textContent).toBe("L-26099");
    rerender(<MonthlyJobCard job={job({ stateLabel: "" })} />);
    expect(screen.queryByTestId("job-card-state")).toBeNull();
  });

  it("muestra las observaciones completas (sin truncar) o «Sin observaciones»", () => {
    const long = "Línea uno.\n" + "x".repeat(600);
    const { rerender } = render(<MonthlyJobCard job={job({ notes: long })} />);
    expect(screen.getByTestId("job-card-observations-text").textContent).toBe(long);
    rerender(<MonthlyJobCard job={job({ notes: "  " })} />);
    expect(screen.getByTestId("job-card-observations-empty").textContent).toBe("Sin observaciones");
  });

  it("lista los comentarios con autor, sector y fecha; el contenido se muestra como texto, no como HTML", async () => {
    render(<MonthlyJobCard job={job()} />);
    await waitFor(() => expect(screen.getByTestId("job-comment-author").textContent).toBe("Ana Depósito"));
    expect(screen.getByTestId("job-comment-sector").textContent).toBe("Depósito");
    expect(screen.getByTestId("job-comment-when").textContent).toBe("02/11/2026 · 10:15");
    expect(screen.getByTestId("job-comment-body").textContent).toBe("Tenemos 1.200 unidades <b>terminadas</b>");
    expect(screen.getByTestId("job-comment-body").querySelector("b")).toBeNull();
  });

  it("no publica comentarios vacíos; publica uno con id estable, lo agrega al final y no se duplica con doble envío", async () => {
    render(<MonthlyJobCard job={job()} />);
    await waitFor(() => expect(screen.getAllByTestId("job-comment")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("job-comment-submit"));
    expect(screen.getByTestId("job-comment-form-error").textContent).toMatch(/Escribí un comentario/);
    expect(posts).toHaveLength(0);
    fireEvent.change(screen.getByTestId("job-comment-input"), { target: { value: "  Priorizar para el jueves  " } });
    fireEvent.submit(screen.getByTestId("job-comment-form"));
    fireEvent.submit(screen.getByTestId("job-comment-form"));
    await waitFor(() => expect(screen.getByTestId("job-comment-notice").textContent).toBe("Comentario publicado"));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ workItemId: "w1", body: "Priorizar para el jueves" });
    expect(typeof posts[0]!.clientRequestId).toBe("string");
    expect(Object.keys(posts[0]!).sort()).toEqual(["body", "clientRequestId", "workItemId"]); // sin autor ni sector
    const items = screen.getAllByTestId("job-comment");
    expect(items).toHaveLength(2);
    expect(items[1]!.textContent).toContain("Priorizar para el jueves");
    expect((screen.getByTestId("job-comment-input") as HTMLTextAreaElement).value).toBe("");
  });
});
