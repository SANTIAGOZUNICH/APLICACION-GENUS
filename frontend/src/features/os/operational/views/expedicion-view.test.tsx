/**
 * @vitest-environment happy-dom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExpedicionCard, filterExpedicionItems } from "./expedicion-view";
import { createTestWorkItem } from "@/lib/__fixtures__/work-item.factory";
import type { QualityItem } from "../types";

function qi(overrides: Partial<QualityItem> & Pick<QualityItem, "id" | "kind" | "status">): QualityItem {
  return {
    lote: null,
    product: "Producto Test",
    client: "Cliente Test",
    oe: null,
    oa: null,
    line: null,
    quantity: "100",
    dayLabel: "Hoy",
    relatedWorkItemId: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

/**
 * Test 7 (auditoría Depósito/Expedición): pendiente y aprobado aparecen en
 * su pestaña; rechazado queda fuera de ambas (misma regla que ya aplica en
 * Calidad); Elaboración ("granel") nunca aparece, sin importar el status —
 * "salida" es, por definición, solo Envasado Masivo/Premium/Codificado.
 */
describe("filterExpedicionItems — scope de Depósito/Expedición", () => {
  const items: QualityItem[] = [
    qi({ id: "salida-pendiente", kind: "salida", status: "pendiente" }),
    qi({ id: "salida-aprobado", kind: "salida", status: "aprobado" }),
    qi({ id: "salida-rechazado", kind: "salida", status: "rechazado" }),
    qi({ id: "granel-pendiente", kind: "granel", status: "pendiente" }),
    qi({ id: "granel-aprobado", kind: "granel", status: "aprobado" }),
  ];

  it("pendientes: solo salida+pendiente — nunca Elaboración, nunca rechazado", () => {
    const result = filterExpedicionItems(items, "pendiente").map((i) => i.id);
    expect(result).toEqual(["salida-pendiente"]);
  });

  it("aprobadas: solo salida+aprobado — nunca Elaboración, nunca rechazado", () => {
    const result = filterExpedicionItems(items, "aprobado").map((i) => i.id);
    expect(result).toEqual(["salida-aprobado"]);
  });

  it("rechazado nunca aparece en ninguna de las dos pestañas", () => {
    const pendientes = filterExpedicionItems(items, "pendiente").map((i) => i.id);
    const aprobadas = filterExpedicionItems(items, "aprobado").map((i) => i.id);
    expect(pendientes).not.toContain("salida-rechazado");
    expect(aprobadas).not.toContain("salida-rechazado");
  });

  it("Elaboración (granel) nunca aparece, ni pendiente ni aprobado", () => {
    const pendientes = filterExpedicionItems(items, "pendiente").map((i) => i.id);
    const aprobadas = filterExpedicionItems(items, "aprobado").map((i) => i.id);
    expect(pendientes).not.toContain("granel-pendiente");
    expect(aprobadas).not.toContain("granel-aprobado");
  });
});

describe("ExpedicionCard — datos reales, nunca inventados", () => {
  it("Test 8: packingGroups completo — 10×100 y 2×50 se ven como líneas separadas, no solo el total 1100", () => {
    const item = qi({ id: "qc:wi-1", kind: "salida", status: "aprobado" });
    const workItem = createTestWorkItem({
      id: "wi-1",
      sector: "CODIFICADO",
      packingGroups: [
        { cajas: 10, unidadesPorCaja: 100 },
        { cajas: 2, unidadesPorCaja: 50 },
      ],
    });

    render(<ExpedicionCard item={item} workItem={workItem} progress={null} />);

    const cajas = screen.getByTestId("expedicion-cajas").textContent ?? "";
    expect(cajas).toMatch(/10 cajas × 100/);
    expect(cajas).toMatch(/2 cajas × 50/);
    expect(screen.getByTestId("expedicion-cantidad-embalada").textContent).toBe("1100 un.");
  });

  it("Lote/VTO completados por Codificado en el work item se ven en Expedición, aunque el QualityItem no los traiga", () => {
    const item = qi({ id: "qc:wi-2", kind: "salida", status: "pendiente", lote: null, vto: null });
    const workItem = createTestWorkItem({
      id: "wi-2",
      sector: "CODIFICADO",
      packagingLote: "L26099",
      packagingVto: "2028-08",
    });

    render(<ExpedicionCard item={item} workItem={workItem} progress={null} />);

    expect(screen.getByTestId("expedicion-lote").textContent).toBe("L26099");
    expect(screen.getByTestId("expedicion-vto").textContent).toBe("2028-08");
  });

  it("sin workItem resuelto, cae al lote/vto del QualityItem — nunca queda vacío si Neon lo tiene", () => {
    const item = qi({ id: "qc:wi-3", kind: "salida", status: "pendiente", lote: "L900", vto: "2027-01" });

    render(<ExpedicionCard item={item} workItem={null} progress={null} />);

    expect(screen.getByTestId("expedicion-lote").textContent).toBe("L900");
    expect(screen.getByTestId("expedicion-vto").textContent).toBe("2027-01");
  });

  it("estado usa el qualityStatus real: pendiente → 'Pendiente de aprobación', aprobado → 'Aprobado'", () => {
    const pendiente = qi({ id: "qc:wi-4", kind: "salida", status: "pendiente" });
    const { unmount } = render(<ExpedicionCard item={pendiente} workItem={null} progress={null} />);
    expect(screen.getByTestId("expedicion-estado").textContent).toBe("Pendiente de aprobación");
    unmount();

    const aprobado = qi({ id: "qc:wi-5", kind: "salida", status: "aprobado" });
    render(<ExpedicionCard item={aprobado} workItem={null} progress={null} />);
    expect(screen.getByTestId("expedicion-estado").textContent).toBe("Aprobado");
  });
});
