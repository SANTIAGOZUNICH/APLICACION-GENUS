import { describe, expect, it } from "vitest";
import {
  applyFeedFilters,
  buildChains,
  canSeeChain,
  canViewProductionObservations,
  chainIndex,
  cleanObservationText,
  countObservations,
  dedupeObservations,
  isObservationNew,
  sortChronological,
  sortNewestFirst,
  tipoFromPending,
  withNewFlag,
  type ChainNode,
  type ObservationCandidate,
} from "./production-observations-core";
import { buildObservationNotification, deterministicObservationNotificationId } from "@/lib/notifications/observation-notification-builder";

const node = (id: string, over: Partial<ChainNode> = {}): ChainNode => ({ id, sector: "ENVASADO_MASIVO", productionPedidoId: null, orderId: null, scheduleRootId: null, parentWorkItemId: null, deleted: false, ...over });
const obs = (id: string, over: Partial<ObservationCandidate> = {}): ObservationCandidate => ({
  id, origin: "ENTREGA_PRODUCCION", originLabel: "Entrega a Producción", deliveryId: id, sequence: 1, sector: "ENVASADO_MASIVO", sectorLabel: "Envasado Masivo", deliveredBy: "Beto", deliveredBySector: "ENVASADO_MASIVO",
  at: "2026-11-10T12:00:00.000Z", tipo: "PARCIAL", quantity: 100, unit: "un.", text: "Faltan tapas", anulada: false, edited: false, workItemId: "w1", workItemSector: "ENVASADO_MASIVO", workItemDeleted: false,
  pedidoId: "p1", pedidoOp: "OP-1", client: "AQUALO", product: "SERUM", orderNumber: "OA-2026-1", lote: "L1", ...over,
});

describe("cleanObservationText", () => {
  it("vacío / espacios → null; recorta; normaliza saltos", () => {
    expect(cleanObservationText("  ")).toBeNull();
    expect(cleanObservationText(null)).toBeNull();
    expect(cleanObservationText(" hola\r\nmundo ")).toBe("hola\nmundo");
  });
  it("las entregas sincronizadas (otra aparición) no son observaciones propias", () => {
    expect(cleanObservationText("x · Entrega sincronizada [sync-from:11111111-1111-1111-1111-111111111111]")).toBeNull();
  });
});

describe("tipo / nuevas", () => {
  it("tipo por saldo", () => {
    expect(tipoFromPending(10)).toBe("PARCIAL");
    expect(tipoFromPending(0)).toBe("TOTAL");
    expect(tipoFromPending(null)).toBeNull();
  });
  it("nueva = posterior a la última visita; sin visita, últimos 7 días; anuladas nunca", () => {
    const now = new Date("2026-11-12T00:00:00Z");
    expect(isObservationNew({ at: "2026-11-10T12:00:00Z", anulada: false }, new Date("2026-11-10T11:00:00Z"), now)).toBe(true);
    expect(isObservationNew({ at: "2026-11-10T12:00:00Z", anulada: false }, new Date("2026-11-10T13:00:00Z"), now)).toBe(false);
    expect(isObservationNew({ at: "2026-11-10T12:00:00Z", anulada: false }, null, now)).toBe(true);
    expect(isObservationNew({ at: "2026-10-01T12:00:00Z", anulada: false }, null, now)).toBe(false);
    expect(isObservationNew({ at: "2026-11-10T12:00:00Z", anulada: true }, null, now)).toBe(false);
  });
});

describe("dedupe / orden / conteo", () => {
  it("dedupe por id (no por texto): mismo texto en dos entregas = dos observaciones", () => {
    const a = obs("a"); const b = obs("b");
    expect(dedupeObservations([a, b, a]).map((o) => o.id)).toEqual(["a", "b"]);
  });
  it("orden: recientes primero / cronológico, desempate estable", () => {
    const l = [obs("a", { at: "2026-11-10T10:00:00Z" }), obs("c", { at: "2026-11-10T12:00:00Z" }), obs("b", { at: "2026-11-10T12:00:00Z" })];
    expect(sortNewestFirst(l).map((o) => o.id)).toEqual(["c", "b", "a"]);
    expect(sortChronological(l).map((o) => o.id)).toEqual(["a", "b", "c"]);
  });
  it("las anuladas se listan pero no cuentan", () => {
    const list = withNewFlag([obs("a"), obs("b", { anulada: true })], null, new Date("2026-11-11T00:00:00Z"));
    expect(countObservations(list)).toEqual({ total: 1, news: 1, anuladas: 1 });
  });
});

describe("cadena del trabajo", () => {
  it("Elaboración, Envasado y Codificado del MISMO pedido forman una cadena; otro pedido del mismo cliente/producto no se mezcla", () => {
    const nodes = [
      node("e1", { sector: "ELABORACION", productionPedidoId: "p1" }),
      node("v1", { productionPedidoId: "p1" }),
      node("c1", { sector: "CODIFICADO", productionPedidoId: "p1", parentWorkItemId: "v1" }),
      node("v2", { productionPedidoId: "p2" }),
    ];
    const idx = chainIndex(buildChains(nodes));
    expect(idx.get("v1")).toEqual(["c1", "e1", "v1"]);
    expect(idx.get("v2")).toEqual(["v2"]);
  });
  it("padre/hijo sin pedido y programaciones de la misma raíz se unen; envío de Elaboración por evento", () => {
    const nodes = [node("v1"), node("c1", { sector: "CODIFICADO", parentWorkItemId: "v1" }), node("v1b", { scheduleRootId: "v1" }), node("e1", { sector: "ELABORACION" }), node("solo")];
    const idx = chainIndex(buildChains(nodes, [{ from: "e1", to: "v1" }]));
    expect(idx.get("c1")).toEqual(["c1", "e1", "v1", "v1b"]);
    expect(idx.get("solo")).toEqual(["solo"]);
  });
  it("misma orden pero pedidos distintos NO se mezcla", () => {
    const idx = chainIndex(buildChains([node("a", { orderId: "o", productionPedidoId: "p1" }), node("b", { orderId: "o", productionPedidoId: "p2" })]));
    expect(idx.get("a")).toEqual(["a"]);
  });
});

describe("permisos", () => {
  it("quién consulta", () => {
    for (const s of ["PRODUCCION", "DIRECCION", "ELABORACION", "ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO"]) expect(canViewProductionObservations(s)).toBe(true);
    for (const s of ["CALIDAD", "DEPOSITO", "ADMINISTRACION", "MATERIA_PRIMA", ""]) expect(canViewProductionObservations(s)).toBe(false);
  });
  it("un sector productivo ve solo cadenas con un trabajo vigente suyo; Producción/Dirección todas", () => {
    const chain = [node("v1"), node("c1", { sector: "CODIFICADO" })];
    expect(canSeeChain("CODIFICADO", chain)).toBe(true);
    expect(canSeeChain("ENVASADO_MASIVO", chain)).toBe(true);
    expect(canSeeChain("ENVASADO_PREMIUM", chain)).toBe(false);
    expect(canSeeChain("ELABORACION", chain)).toBe(false);
    expect(canSeeChain("PRODUCCION", chain)).toBe(true);
    expect(canSeeChain("CODIFICADO", [node("c1", { sector: "CODIFICADO", deleted: true })])).toBe(false);
  });
});

describe("filtros del listado", () => {
  const list = withNewFlag([
    obs("a", { sector: "ENVASADO_MASIVO", client: "AQUALO", at: "2026-11-11T10:00:00Z" }),
    obs("b", { sector: "CODIFICADO", sectorLabel: "Codificado", client: "NATURA", pedidoOp: "OP-77", at: "2026-10-01T10:00:00Z" }),
    obs("c", { sector: "ELABORACION", anulada: true, text: "Sobró granel" }),
  ], new Date("2026-11-01T00:00:00Z"), new Date("2026-11-12T00:00:00Z"));
  it("por sector, por cliente/pedido (sin tildes ni mayúsculas), solo nuevas y sin anuladas", () => {
    expect(applyFeedFilters(list, { sector: "CODIFICADO" }).map((o) => o.id)).toEqual(["b"]);
    expect(applyFeedFilters(list, { q: "natura" }).map((o) => o.id)).toEqual(["b"]);
    expect(applyFeedFilters(list, { q: "op-77" }).map((o) => o.id)).toEqual(["b"]);
    expect(applyFeedFilters(list, { q: "SOBRÓ" }).map((o) => o.id)).toEqual(["c"]);
    expect(applyFeedFilters(list, { onlyNew: true }).map((o) => o.id)).toEqual(["a"]);
    expect(applyFeedFilters(list, { includeAnuladas: false }).map((o) => o.id)).toEqual(["a", "b"]);
  });
});

describe("aviso a Producción (builder)", () => {
  const base = { source: "LINEA" as const, eventKey: "line-1", workItemId: "w1", sector: "ENVASADO_MASIVO", actorName: "Beto", observation: "Faltan 20 tapas", at: new Date("2026-11-10T12:00:00Z"), client: "AQUALO", product: "SERUM", pedido: "OP-1", orderRef: "OA-2026-1", lote: "L1", quantity: 100, unit: "un.", tipo: "PARCIAL" as const };
  it("sin observación no hay aviso", () => {
    expect(buildObservationNotification({ ...base, observation: "   " })).toBeNull();
  });
  it("id determinístico por línea (mismo evento = mismo id; otra línea = otro id) y destinatarios Producción/Dirección", () => {
    const a = buildObservationNotification(base)!;
    expect(buildObservationNotification(base)!.id).toBe(a.id);
    expect(a.id).toBe(deterministicObservationNotificationId("LINEA", "line-1"));
    expect(buildObservationNotification({ ...base, eventKey: "line-2" })!.id).not.toBe(a.id);
    expect(a.sectors).toEqual(["PRODUCCION", "DIRECCION"]);
    expect(a.kind).toBe("observacion_entrega");
    expect(a.href).toContain("workItemId=native%3Aw1");
    for (const s of ["Envasado Masivo", "AQUALO", "SERUM", "OP-1", "OA-2026-1", "Lote: L1", "Entrega parcial", "Faltan 20 tapas", "Beto"]) expect(a.message).toContain(s);
  });
});
