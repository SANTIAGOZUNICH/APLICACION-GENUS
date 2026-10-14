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
 * Circuito sin Calidad (reemplaza al test 7 de la auditoría Depósito/Expedición, que probaba el filtrado por la decisión
 * pendiente/aprobado de Calidad — comportamiento eliminado a propósito): «listos» = terminados sin entrega
 * (operationalStatus revision) y «entregados» = entrega cumplida; Elaboración ("granel") nunca aparece; los demás
 * estados (en curso, cancelado) quedan fuera. La decisión histórica de Calidad ya no influye.
 */
describe("filterExpedicionItems — scope de Depósito/Expedición", () => {
  const items: QualityItem[] = [
    qi({ id: "salida-listo", kind: "salida", status: "pendiente", operationalStatus: "revision" }),
    qi({ id: "salida-listo-aprobado-historico", kind: "salida", status: "aprobado", operationalStatus: "revision" }),
    qi({ id: "salida-entregado", kind: "salida", status: "aprobado", operationalStatus: "entregado" }),
    qi({ id: "salida-en-curso", kind: "salida", status: "pendiente", operationalStatus: "en_curso" }),
    qi({ id: "salida-cancelado", kind: "salida", status: "pendiente", operationalStatus: "cancelado" }),
    qi({ id: "granel-listo", kind: "granel", status: "pendiente", operationalStatus: "revision" }),
    qi({ id: "granel-entregado", kind: "granel", status: "aprobado", operationalStatus: "entregado" }),
  ];

  it("listos: solo salida+revision (sin importar la decisión histórica de Calidad)", () => {
    const result = filterExpedicionItems(items, "listos").map((i) => i.id);
    expect(result).toEqual(["salida-listo", "salida-listo-aprobado-historico"]);
  });

  it("entregados: solo salida+entregado", () => {
    expect(filterExpedicionItems(items, "entregados").map((i) => i.id)).toEqual(["salida-entregado"]);
  });

  it("en curso y cancelado nunca aparecen en ninguna pestaña", () => {
    const ids = [...filterExpedicionItems(items, "listos"), ...filterExpedicionItems(items, "entregados")].map((i) => i.id);
    expect(ids).not.toContain("salida-en-curso");
    expect(ids).not.toContain("salida-cancelado");
  });

  it("Elaboración (granel) nunca aparece", () => {
    const ids = [...filterExpedicionItems(items, "listos"), ...filterExpedicionItems(items, "entregados")].map((i) => i.id);
    expect(ids).not.toContain("granel-listo");
    expect(ids).not.toContain("granel-entregado");
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

  // Test 9 (advertencias no bloqueantes): Expedición ve la misma advertencia
  // que Calidad/Producción, calculada del mismo WorkItem canónico.
  it("Test 9: muestra el warning rojo de datos faltantes cuando el WorkItem resuelto los tiene vacíos", () => {
    const item = qi({ id: "qc:wi-warn", kind: "salida", status: "aprobado" });
    const workItem = createTestWorkItem({
      id: "wi-warn",
      sector: "CODIFICADO",
      status: "codificado_completo",
      originStage: "CODIFICADO",
      packagingLote: null,
      packagingVto: null,
      packingGroups: [{ cajas: 1, unidadesPorCaja: 500 }],
    });

    render(<ExpedicionCard item={item} workItem={workItem} progress={null} />);
    expect(screen.getByTestId("work-item-warning-badge").textContent).toContain("FALTA LOTE Y VTO");
  });

  it("sin WorkItem resuelto, no muestra ningún warning (nunca inventa datos)", () => {
    const item = qi({ id: "qc:wi-nowarn", kind: "salida", status: "aprobado" });
    render(<ExpedicionCard item={item} workItem={null} progress={null} />);
    expect(screen.queryByTestId("work-item-warning-badge")).toBeNull();
  });

  // Reemplaza al test que probaba «pendiente → Pendiente de aprobación / aprobado → Aprobado» (decisión de Calidad,
  // eliminada del circuito a propósito): ahora el estado es el operativo real del trabajo.
  it("estado usa el estado operativo real: revision → 'Listo para entregar', entregado → 'Entregado'", () => {
    const listo = qi({ id: "qc:wi-4", kind: "salida", status: "pendiente", operationalStatus: "revision" });
    const { unmount } = render(<ExpedicionCard item={listo} workItem={null} progress={null} />);
    expect(screen.getByTestId("expedicion-estado").textContent).toBe("Listo para entregar");
    unmount();

    const entregado = qi({ id: "qc:wi-5", kind: "salida", status: "aprobado", operationalStatus: "entregado" });
    render(<ExpedicionCard item={entregado} workItem={null} progress={null} />);
    expect(screen.getByTestId("expedicion-estado").textContent).toBe("Entregado");
  });
});
