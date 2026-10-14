/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const previewMock = vi.fn();
const commitMock = vi.fn();
vi.mock("@/lib/metricas/metricas-client", () => ({
  previewMetricasImport: (...a: unknown[]) => previewMock(...a),
  commitMetricasImport: (...a: unknown[]) => commitMock(...a),
}));

import { MetricasPasteDialog } from "./metricas-paste-dialog";

const session = { email: "m@x.com", sector: "ENVASADO_MASIVO" } as never;

function setup(props: Partial<React.ComponentProps<typeof MetricasPasteDialog>> = {}) {
  const onDone = vi.fn();
  render(<MetricasPasteDialog open onOpenChange={() => {}} session={session} isAdmin={false} ownSector="ENVASADO_MASIVO" onDone={onDone} {...props} />);
  return { onDone };
}
const paste = (text: string) => fireEvent.change(screen.getByTestId("metricas-paste-textarea"), { target: { value: text } });

beforeEach(() => {
  previewMock.mockReset();
  commitMock.mockReset();
  // El servidor clasifica en el mismo orden en que recibe las filas.
  previewMock.mockImplementation(async (_s: unknown, rows: unknown[]) => rows.map((_, index) => ({ index, status: "new" })));
  commitMock.mockResolvedValue({ batchId: "b", created: 2, updated: 0, skipped: 0, results: [] });
});
afterEach(cleanup);

describe("MetricasPasteDialog", () => {
  it("interpreta filas y columnas pegadas desde Excel (tabuladores, coma decimal, fechas dd/mm/aaaa)", async () => {
    setup();
    paste("15/10/2026\tSHAMPOO\t1.200\tAna\r\n16/10/2026\tCREMA\t800,0\tLuis\r\n");
    const rows = await screen.findAllByTestId("metricas-paste-row");
    expect(rows).toHaveLength(2);
    expect((within(rows[0]!).getByTestId("metricas-paste-cell-metricDate") as HTMLInputElement).value).toBe("15/10/2026");
    expect((within(rows[0]!).getByTestId("metricas-paste-cell-units") as HTMLInputElement).value).toBe("1.200");
    await waitFor(() => expect(screen.getByTestId("metricas-paste-summary").textContent).toMatch(/2 nuevas/));
  });

  it("muestra el error en la celda correspondiente, y se corrige editando esa celda", async () => {
    setup();
    paste("15/10/2026\tGEL\t12,5\tAna");
    const row = (await screen.findAllByTestId("metricas-paste-row"))[0]!;
    expect(within(row).getByTestId("metricas-paste-cell-units").getAttribute("data-error")).toBe("1");
    expect(within(row).getByTestId("metricas-paste-cell-error").textContent).toMatch(/entero/);
    expect(within(row).getByTestId("metricas-paste-cell-metricDate").getAttribute("data-error")).toBeNull();
    expect((screen.getByTestId("metricas-paste-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(row).getByTestId("metricas-paste-cell-units"), { target: { value: "12" } });
    await waitFor(() => expect(within(screen.getAllByTestId("metricas-paste-row")[0]!).getByTestId("metricas-paste-cell-units").getAttribute("data-error")).toBeNull());
    await waitFor(() => expect((screen.getByTestId("metricas-paste-confirm") as HTMLButtonElement).disabled).toBe(false));
  });

  it("confirmar envía solo lo nuevo, con el orden pegado, y avisa al terminar", async () => {
    const { onDone } = setup();
    paste("Responsable\tUnidades\tFecha\tProducto\nAna\t500\t01/11/2026\tGEL\nLuis\t300\t02/11/2026\tCREMA");
    await waitFor(() => expect((screen.getByTestId("metricas-paste-confirm") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("metricas-paste-confirm"));
    await waitFor(() => expect(commitMock).toHaveBeenCalledTimes(1));
    const arg = commitMock.mock.calls[0]![1] as { rows: Array<Record<string, unknown>>; overwrite: Record<string, string>; batchId: string };
    expect(arg.rows).toEqual([
      { metricDate: "2026-11-01", product: "GEL", units: 500, responsibleDisplay: "Ana", sector: "ENVASADO_MASIVO" },
      { metricDate: "2026-11-02", product: "CREMA", units: 300, responsibleDisplay: "Luis", sector: "ENVASADO_MASIVO" },
    ]);
    expect(arg.overwrite).toEqual({});
    expect(arg.batchId.length).toBeGreaterThan(5);
    await screen.findByTestId("metricas-paste-result");
    expect(onDone).toHaveBeenCalled();
  });

  it("los registros que ya existen NO se envían ni se pisan salvo que se tilde «Pisar unidades»", async () => {
    previewMock.mockImplementation(async (_s: unknown, rows: unknown[]) =>
      rows.map((_, index) =>
        index === 0 ? { index, status: "identical", existing: { id: "e0", units: 500, updatedAt: "u0" } }
          : index === 1 ? { index, status: "conflict", existing: { id: "e1", units: 100, updatedAt: "2026-10-01T00:00:00.000Z" }, message: "Ya existe con 100 unidades" }
          : { index, status: "new" })
    );
    setup();
    paste("01/11/2026\tA\t500\tAna\n02/11/2026\tB\t999\tAna\n03/11/2026\tC\t10\tAna");
    await waitFor(() => expect(screen.getByTestId("metricas-paste-summary").textContent).toMatch(/1 nuevas.*1 ya existen iguales.*1 existen con otras unidades/));
    // Sin tildar: solo viaja la nueva.
    fireEvent.click(screen.getByTestId("metricas-paste-confirm"));
    await waitFor(() => expect(commitMock).toHaveBeenCalledTimes(1));
    let arg = commitMock.mock.calls[0]![1] as { rows: Array<{ product: string }>; overwrite: Record<string, string> };
    expect(arg.rows.map((r) => r.product)).toEqual(["C"]);
    expect(arg.overwrite).toEqual({});
  });

  it("tildar «Pisar unidades» envía la fila con la versión que el usuario vio", async () => {
    previewMock.mockImplementation(async (_s: unknown, rows: unknown[]) =>
      rows.map((_, index) => ({ index, status: "conflict", existing: { id: "e1", units: 100, updatedAt: "2026-10-01T00:00:00.000Z" }, message: "x" }))
    );
    setup();
    paste("02/11/2026\tB\t999\tAna");
    const box = await screen.findByTestId("metricas-paste-overwrite");
    expect((screen.getByTestId("metricas-paste-confirm") as HTMLButtonElement).disabled).toBe(true); // nada que hacer sin confirmar
    fireEvent.click(box);
    await waitFor(() => expect((screen.getByTestId("metricas-paste-confirm") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("metricas-paste-confirm"));
    await waitFor(() => expect(commitMock).toHaveBeenCalledTimes(1));
    const arg = commitMock.mock.calls[0]![1] as { rows: unknown[]; overwrite: Record<string, string> };
    expect(arg.rows).toHaveLength(1);
    expect(arg.overwrite).toEqual({ "0": "2026-10-01T00:00:00.000Z" });
  });

  it("Producción: columna Sector o sector elegido por defecto", async () => {
    setup({ isAdmin: true, ownSector: null });
    paste("15/10/2026\tPremium\tSERUM\t300\tAna\n16/10/2026\tCREMA\t100\tLuis");
    // La segunda fila tiene solo 4 columnas: se interpreta con el ancho mayor (5) → Sector = «CREMA»: error de sector.
    const rows = await screen.findAllByTestId("metricas-paste-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).getByTestId("metricas-paste-cell-sector").getAttribute("data-error")).toBe("1");
  });

  it("un doble clic en confirmar no envía dos veces", async () => {
    commitMock.mockImplementation(() => new Promise((r) => setTimeout(() => r({ batchId: "b", created: 1, updated: 0, skipped: 0, results: [] }), 30)));
    setup();
    paste("15/10/2026\tGEL\t5\tAna");
    await waitFor(() => expect((screen.getByTestId("metricas-paste-confirm") as HTMLButtonElement).disabled).toBe(false));
    const btn = screen.getByTestId("metricas-paste-confirm");
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByTestId("metricas-paste-result");
    expect(commitMock).toHaveBeenCalledTimes(1);
  });
});
