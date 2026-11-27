import { describe, expect, it } from "vitest";
import { belongsToClient, buildNameIndex, choicesMatching, isClientUuid, manualStageOf, resolveName, workOwner } from "./client-link-rules";
import { buildOverview } from "./overview";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const index = buildNameIndex(
  [
    { id: A, displayName: "GENUS TEST" },
    { id: B, displayName: "GENUS TEST 2" },
    { id: C, displayName: "Genus" },
  ],
  [
    { clientId: A, nameKey: "genus test" },
    { clientId: B, nameKey: "genus test 2" },
    { clientId: C, nameKey: "genus" },
  ]
);

describe("resolveName (vínculo por nombre solo si es inequívoco)", () => {
  it("ignora mayúsculas, tildes y espacios repetidos", () => {
    expect(resolveName("  Genus   TEST ", index)).toEqual({ status: "unique", clientId: A });
    expect(resolveName("GÉNUS test 2", index)).toEqual({ status: "unique", clientId: B });
  });
  it("un prefijo NO es una coincidencia: «Genus» no es «Genus Test»", () => {
    expect(resolveName("Genus", index)).toEqual({ status: "unique", clientId: C });
    expect(resolveName("Genus Tes", index)).toEqual({ status: "none" });
    expect(resolveName("Genus Test 3", index)).toEqual({ status: "none" });
  });
  it("guion, sufijo societario o sin espacio NO coinciden (no se adivina)", () => {
    for (const v of ["GENUS-TEST", "GENUS TEST S.A.", "GENUSTEST"]) expect(resolveName(v, index)).toEqual({ status: "none" });
  });
  it("el mismo nombre en dos clientes es AMBIGUO", () => {
    const amb = buildNameIndex([{ id: A, displayName: "Dup" }, { id: B, displayName: "Otro" }], [{ clientId: B, nameKey: "dup" }]);
    expect(resolveName("DUP", amb)).toEqual({ status: "ambiguous", clientIds: [A, B].sort() });
  });
  it("placeholders y vacío no son clientes", () => {
    for (const v of ["", "  ", "s/d", null, undefined, 7]) expect(resolveName(v, index)).toEqual({ status: "none" });
  });
});

describe("dueño de un trabajo", () => {
  it("el ID del pedido manda sobre el del trabajo; sin ID → por nombre", () => {
    expect(workOwner(B, A)).toEqual({ kind: "client", clientId: A, by: "id" });
    expect(workOwner(B, null)).toEqual({ kind: "client", clientId: B, by: "id" });
    expect(workOwner(null, null)).toEqual({ kind: "name" });
  });
  it("con ID, el nombre del trabajo es irrelevante (aislamiento por ID)", () => {
    const owner = workOwner(null, A);
    expect(belongsToClient(owner, "GENUS TEST 2", A, index)).toBe(true);
    expect(belongsToClient(owner, "GENUS TEST", B, index)).toBe(false);
  });
  it("sin ID solo pertenece al cliente que el nombre resuelve ÚNICAMENTE", () => {
    const owner = workOwner(null, null);
    expect(belongsToClient(owner, "Genus Test", A, index)).toBe(true);
    expect(belongsToClient(owner, "Genus Test", B, index)).toBe(false);
    expect(belongsToClient(owner, "Genus Test", C, index)).toBe(false);
  });
});

describe("selector del formulario", () => {
  const choices = [{ id: A, labels: ["GENUS TEST", "Genus Test SA"] }, { id: B, labels: ["GENUS TEST 2"] }];
  it("coincide solo con la etiqueta exacta normalizada", () => {
    expect(choicesMatching("genus  test", choices)).toEqual([A]);
    expect(choicesMatching("Genus Test SA", choices)).toEqual([A]);
    expect(choicesMatching("Genus Te", choices)).toEqual([]);
    expect(choicesMatching("", choices)).toEqual([]);
  });
  it("valida uuid", () => {
    expect(isClientUuid(A)).toBe(true);
    expect(isClientUuid("x'; drop table")).toBe(false);
    expect(isClientUuid(null)).toBe(false);
  });
});

describe("estado manual de un pedido sin trabajos", () => {
  it("mapea Elaboración/Envasado y también Listo/Entregado (vías reales del estado del pedido)", () => {
    expect(manualStageOf("EN_ELABORACION")).toBe("ELABORACION");
    expect(manualStageOf("EN_ENVASADO")).toBe("ENVASADO");
    expect(manualStageOf("EN_CODIFICADO")).toBe("ENVASADO");
    expect(manualStageOf("LISTO_PARA_ENTREGAR")).toBe("LISTO");
    expect(manualStageOf("LISTO PARA ENTREGAR")).toBe("LISTO");
    expect(manualStageOf("TERMINADO")).toBe("LISTO");
    expect(manualStageOf("ENTREGADO")).toBe("ENTREGADO");
    expect(manualStageOf("INGRESO")).toBeNull();
    expect(manualStageOf(null)).toBeNull();
  });

  const base = { clientId: A, works: [], deliveries: [], events: [], confirmations: new Map(), now: new Date("2039-01-10T12:00:00Z") };
  process.env.PORTAL_AUTH_SECRET ??= "unit-test-secret-".padEnd(40, "x");
  it("pedido recién asignado → «Pedido recibido»; con estado manual → En elaboración / En envasado", () => {
    const ov = buildOverview({
      ...base,
      pedidos: [
        { id: "p1", op: "OP-1", producto: "SHAMPOO", estado: null, cancelledWorks: 0 },
        { id: "p2", op: "OP-2", producto: "CREMA", estado: "EN_ELABORACION", cancelledWorks: 0, manualStage: "ELABORACION" },
        { id: "p3", op: "OP-3", producto: "GEL", estado: "EN_ENVASADO", cancelledWorks: 0, manualStage: "ENVASADO" },
        { id: "p4", op: "OP-4", producto: "JABON", estado: "ENTREGADO", cancelledWorks: 0, manualStage: null },
        { id: "p5", op: "OP-5", producto: "TONICO", estado: "INGRESO", cancelledWorks: 1 },
      ],
    });
    const byOp = Object.fromEntries(ov.products.map((p) => [p.orderRef, p.commercial.label]));
    expect(byOp).toEqual({ "OP-1": "Pedido recibido", "OP-2": "En elaboración", "OP-3": "En envasado", "OP-5": "Cancelado" });
    expect(byOp["OP-4"]).toBeUndefined(); // ENTREGADO manual sin trabajos: no se inventa
    expect(ov.orders.find((o) => o.orderRef === "OP-1")!.status.label).toBe("Pedido recibido");
  });
});

import { pedidoSentToSector } from "./client-link-rules";
describe("pedidoSentToSector", () => {
  it("el pedido ya enviado a un sector (estado EN_*) cuenta como iniciado", () => {
    for (const e of ["EN_ELABORACION", "en_envasado", "EN_CODIFICADO", "LISTO_PARA_ENTREGAR"]) expect(pedidoSentToSector(e)).toBe(true);
  });
  it("sin estado o INGRESO no", () => {
    for (const e of [null, undefined, "", "INGRESO", "ENTREGADO"]) expect(pedidoSentToSector(e)).toBe(false);
  });
});
