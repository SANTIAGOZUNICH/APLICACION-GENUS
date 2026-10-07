/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeRemitoAiDialog } from "./me-remito-ai-dialog";

vi.mock("@/features/os/auth/lib/auth-session-helpers", () => ({
  getCurrentAuthSession: () => ({ user: { email: "deposito@laboratoriogenus.com.ar" }, sector: { id: "DEPOSITO" } }),
}));

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const catalog = [
  { id: "m1", codigo: "GOT-N", descripcion: "GOTERO NEGRO", archived: false },
  { id: "m2", codigo: "EST-R", descripcion: "ESTUCHE ROSEHIP", archived: false },
];

function line(over: Record<string, unknown>) {
  return {
    id: "l1",
    descripcionOriginal: "GOTERO NEGRO",
    codigoProveedor: "",
    cantidadTexto: "2.000",
    cantidadInterpretada: 2000,
    unidad: "UN",
    unidadOriginal: "UN",
    requiereConversion: false,
    materialSugeridoId: "m1",
    confianza: "ALTA",
    matchSource: "DESCRIPCION",
    candidates: [{ materialId: "m1", codigo: "GOT-N", descripcion: "GOTERO NEGRO", score: 1 }],
    warnings: [],
    revisarCantidad: false,
    includeDefault: true,
    ...over,
  };
}

const preview = {
  docId: "doc-1",
  header: { proveedor: "Vidriería Norte", numeroRemito: "0001-000123", fecha: "2026-10-05" },
  warnings: [],
  duplicate: null,
  ia: { provider: "gemini", model: "x" },
  lines: [
    line({}),
    line({ id: "l2", descripcionOriginal: "ESTUCHE ROSEHIP", cantidadTexto: "1.000", cantidadInterpretada: 1000, materialSugeridoId: null, confianza: "BAJA", candidates: [] }),
  ],
};

function mount() {
  const onDone = vi.fn();
  render(<MeRemitoAiDialog open onClose={vi.fn()} onDone={onDone} onShowIngresos={vi.fn()} />);
  return { onDone };
}

async function upload(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByTestId("remito-camera-input") as HTMLInputElement;
  await user.upload(input, new File([new Uint8Array([0xff, 0xd8, 0xff])], "foto.jpg", { type: "image/jpeg" }));
  await user.click(await screen.findByRole("button", { name: "Analizar remito" }));
}

describe("MeRemitoAiDialog — preview obligatoria antes de crear ingresos", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("no permite confirmar hasta resolver el material; no guarda nada al analizar", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("resource=me_stock")) return Promise.resolve(json({ data: catalog }));
      if (url.includes("/remito-ai/analyze")) return Promise.resolve(json({ data: preview }));
      throw new Error(`unexpected ${url}`);
    });
    const user = userEvent.setup();
    mount();
    await upload(user);

    expect((await screen.findByTestId("remito-summary")).textContent).toContain("2 materiales detectados · 1 asociados · 1 requieren revisión");
    const confirm = screen.getByTestId("remito-confirm");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/confirm"))).toBe(false);

    // Operario resuelve la fila dudosa → se habilita y recién ahí confirma.
    const selects = screen.getAllByTestId("remito-line-material");
    await user.selectOptions(selects[1]!, "m2");
    await waitFor(() => expect((screen.getByTestId("remito-confirm") as HTMLButtonElement).disabled).toBe(false));

    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/remito-ai/confirm")) {
        return Promise.resolve(
          json({
            data: {
              doc: { numeroRemito: "0001-000123", proveedor: "Vidriería Norte" },
              ingresos: [{ id: "i1", materialId: "m1", codigo: "GOT-N", descripcionInsumo: "GOTERO NEGRO", total: 2000 }],
              stock: [{ materialId: "m1", stockActual: -100, negativo: true }],
            },
          })
        );
      }
      return Promise.resolve(json({ data: catalog }));
    });
    await user.click(screen.getByTestId("remito-confirm"));
    const done = await screen.findByTestId("remito-done");
    expect(done.textContent).toContain("INGRESOS REGISTRADOS");
    expect(done.textContent).toContain("🔴 STOCK ACTUAL: -100 un.");
    const confirmCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/confirm"))!;
    const body = JSON.parse((confirmCall[1] as RequestInit).body as string);
    expect(body.lines).toEqual([
      { lineId: "l1", include: true, materialId: "m1", cantidad: 2000, conversionConfirmada: false },
      { lineId: "l2", include: true, materialId: "m2", cantidad: 1000, conversionConfirmada: false },
    ]);
  });

  it("remito ilegible muestra el mensaje de nueva foto", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("resource=me_stock")) return Promise.resolve(json({ data: catalog }));
      return Promise.resolve(
        json({ error: "NO PUDIMOS LEER EL REMITO CON SEGURIDAD. Sacá otra foto procurando incluir el documento completo.", code: "REMITO_ILEGIBLE" }, 422)
      );
    });
    const user = userEvent.setup();
    mount();
    await upload(user);
    expect((await screen.findByTestId("remito-ai-error")).textContent).toMatch(/NO PUDIMOS LEER EL REMITO CON SEGURIDAD/);
  });

  it("remito duplicado: 🔴 ESTE REMITO YA FUE CARGADO y no ofrece volver a cargarlo", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("resource=me_stock")) return Promise.resolve(json({ data: catalog }));
      return Promise.resolve(
        json({
          data: {
            docId: null,
            header: { proveedor: "Vidriería Norte", numeroRemito: "0001-000123", fecha: null },
            lines: [],
            warnings: [],
            ia: null,
            duplicate: { docId: "d0", proveedor: "Vidriería Norte", numeroRemito: "0001-000123", confirmedAt: "2026-10-06T10:00:00Z", confirmedBy: "deposito@laboratoriogenus.com.ar", ingresoIds: ["i"], ingresoNros: ["ME-I-00001"], motivo: "NUMERO" },
          },
        })
      );
    });
    const user = userEvent.setup();
    mount();
    await upload(user);
    const box = await screen.findByTestId("remito-duplicate");
    expect(box.textContent).toContain("ESTE REMITO YA FUE CARGADO");
    expect(screen.queryByTestId("remito-confirm")).toBeNull();
    expect(screen.getByRole("button", { name: "VER INGRESOS" })).toBeTruthy();
  });
});
