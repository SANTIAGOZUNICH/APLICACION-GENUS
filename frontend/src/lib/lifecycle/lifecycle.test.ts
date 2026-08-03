import { describe, expect, it } from "vitest";
import {
  canAnnul,
  canArchive,
  canDelete,
  canHardDelete,
  canRestore,
  matchesVisibilityFilter,
  resolvePrimaryLifecycleAction,
  type LifecycleEntityState,
} from "./policy";
import { deleteBlobsThenMetadata } from "./blob-safe";
import {
  clearLifecycleAuditForTests,
  listLifecycleAudit,
  recordLifecycleEvent,
} from "./audit";
import { orderLifecycleActions } from "./adapters/orders";
import {
  avisoLifecycleActions,
  metricaLifecycleActions,
  mpStockLifecycleActions,
  mpControlLifecycleActions,
  plantillaLifecycleActions,
} from "./adapters/common";

describe("lifecycle policy", () => {
  it("borra borrador pendiente sin refs", () => {
    const entity: LifecycleEntityState = {
      kind: "trabajo",
      id: "w1",
      status: "pendiente",
      isDraft: true,
    };
    const d = canDelete(entity);
    expect(d.allowed).toBe(true);
    expect(d.action).toBe("eliminar");
    expect(d.requireReason).toBe(true);
  });

  it("impide borrar confirmado con referencias", () => {
    const d = canDelete({
      kind: "lote",
      id: "l1",
      status: "CONFIRMADO",
      referencedBy: [{ kind: "oe", id: "oe1", label: "OE-1" }],
    });
    expect(d.allowed).toBe(false);
    expect(d.httpStatusIfDenied).toBe(409);
  });

  it("anular requiere motivo y conserva auditoría", () => {
    const d = canAnnul({
      kind: "oe",
      id: "oe1",
      status: "COMPLETA",
    });
    expect(d.allowed).toBe(true);
    expect(d.action).toBe("anular");
    expect(d.requireReason).toBe(true);
    expect(d.impact?.preservesAudit).toBe(true);
  });

  it("archivar / restaurar", () => {
    const arch = canArchive({ kind: "remito", id: "r1", status: "GENERADO" });
    expect(arch.allowed).toBe(true);
    expect(arch.action).toBe("archivar");

    const rest = canRestore({
      kind: "remito",
      id: "r1",
      status: "ARCHIVADO",
      archived: true,
    });
    expect(rest.allowed).toBe(true);
    expect(rest.action).toBe("restaurar");
  });

  it("eliminar definitivo exige archivado y sin refs + doble confirmación", () => {
    const blocked = canHardDelete({
      kind: "entrega",
      id: "e1",
      status: "entregado",
      referencedBy: [{ kind: "oe", id: "x", label: "OE" }],
    });
    expect(blocked.allowed).toBe(false);

    const ok = canHardDelete({
      kind: "entrega",
      id: "e1",
      status: "ARCHIVADO",
      archived: true,
    });
    expect(ok.allowed).toBe(true);
    expect(ok.requireDoubleConfirm).toBe(true);
    expect(ok.requireReason).toBe(true);
  });

  it("filtro de visibilidad", () => {
    expect(
      matchesVisibilityFilter("activos", { status: "COMPLETA" })
    ).toBe(true);
    expect(
      matchesVisibilityFilter("activos", { status: "ARCHIVADA" })
    ).toBe(false);
    expect(
      matchesVisibilityFilter("anulados", { status: "ANULADA" })
    ).toBe(true);
    expect(
      matchesVisibilityFilter("archivados", { status: "ARCHIVADO", archived: true })
    ).toBe(true);
    expect(matchesVisibilityFilter("todos", { status: "ANULADO" })).toBe(true);
  });

  it("fórmula utilizada no eliminable", () => {
    const d = canDelete({
      kind: "formula",
      id: "f1",
      status: "ACTIVA",
      referencedBy: [{ kind: "oe", id: "oe1", label: "OE-99" }],
    });
    expect(d.allowed).toBe(false);
  });

  it("adapter OE: borrador eliminar; completa anular/archivar", () => {
    const draft = orderLifecycleActions({
      id: "1",
      type: "OE",
      status: "BORRADOR",
    });
    expect(draft.eliminar.allowed).toBe(true);
    expect(draft.anular.action).toBe("eliminar");

    const done = orderLifecycleActions({
      id: "2",
      type: "OE",
      status: "COMPLETA",
    });
    expect(done.eliminar.allowed).toBe(false);
    expect(done.anular.allowed).toBe(true);
    expect(done.archivar.allowed).toBe(true);
  });

  it("stock MP no se elimina directamente", () => {
    const d = mpStockLifecycleActions({ id: "s1", codigo: "ABC" });
    expect(d.eliminar.allowed).toBe(false);
  });

  it("plantilla obsoleta se restaura; métrica archivada se restaura", () => {
    expect(
      plantillaLifecycleActions({ id: "t1", status: "OBSOLETA" }).restaurar.allowed
    ).toBe(true);
    expect(
      metricaLifecycleActions({ id: "m1", deletedAt: "2026-01-01" }).restaurar.allowed
    ).toBe(true);
    expect(
      avisoLifecycleActions({ id: "a1", archivedAt: "2026-01-01" }).restaurar.allowed
    ).toBe(true);
  });

  it("resolvePrimaryLifecycleAction", () => {
    const p = resolvePrimaryLifecycleAction({
      kind: "trabajo",
      id: "t",
      status: "pendiente",
      isDraft: true,
    });
    expect(p.action).toBe("eliminar");
  });

  it("adapter MP control: borrador eliminar; completo anular/archivar; archivado restaurar", () => {
    const draft = mpControlLifecycleActions({ id: "1", status: "BORRADOR" });
    expect(draft.eliminar.allowed).toBe(true);

    const done = mpControlLifecycleActions({ id: "2", status: "COMPLETADO" });
    expect(done.eliminar.allowed).toBe(false);
    expect(done.anular.allowed).toBe(true);
    expect(done.archivar.allowed).toBe(true);

    const linked = mpControlLifecycleActions({
      id: "3",
      status: "COMPLETADO",
      linkedOeId: "oe-99",
    });
    expect(linked.eliminar.allowed).toBe(false);
    expect(linked.anular.impact?.references.length).toBeGreaterThan(0);

    const archived = mpControlLifecycleActions({ id: "4", status: "ARCHIVADO" });
    expect(archived.restaurar.allowed).toBe(true);
  });
});

describe("lifecycle audit + blob-safe", () => {
  it("registra actor sector motivo", () => {
    clearLifecycleAuditForTests();
    recordLifecycleEvent({
      entityKind: "oe",
      entityId: "oe1",
      action: "anular",
      actor: { email: "p@test", sector: "PRODUCCION" },
      reason: "error de carga",
    });
    const ev = listLifecycleAudit("oe1")[0]!;
    expect(ev.actorEmail).toBe("p@test");
    expect(ev.actorSector).toBe("PRODUCCION");
    expect(ev.reason).toBe("error de carga");
  });

  it("Blob OK borra metadata; fallo conserva metadata", async () => {
    const deleted: string[] = [];
    let metaDeleted = false;
    const ok = await deleteBlobsThenMetadata({
      storage: {
        delete: async (k) => {
          deleted.push(k);
        },
      },
      keys: ["a", "b"],
      afterBlobsDeleted: async () => {
        metaDeleted = true;
      },
    });
    expect(ok.ok).toBe(true);
    expect(deleted).toEqual(["a", "b"]);
    expect(metaDeleted).toBe(true);

    let metaDeleted2 = false;
    const fail = await deleteBlobsThenMetadata({
      storage: {
        delete: async (k) => {
          if (k === "bad") throw new Error("blob down");
        },
      },
      keys: ["ok", "bad"],
      afterBlobsDeleted: async () => {
        metaDeleted2 = true;
      },
    });
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.failedKey).toBe("bad");
    expect(metaDeleted2).toBe(false);
  });
});
