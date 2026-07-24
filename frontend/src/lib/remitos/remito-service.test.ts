/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeCajasProduct,
  packingTotalMismatchWarning,
} from "./packing-math";
import { consolidateLinesByProductLoteVto, normalizeClientId, remitoGroupKey } from "./grouping";
import { canAccessRemitos } from "./types";
import {
  getRemitoService,
  resetRemitoMemoryForTests,
} from "./remito-service";
import * as driveWrite from "./drive-write";
import * as featureSchema from "@/lib/db/feature-schema";
import * as remitoSchema from "@/lib/db/remito-schema";

const prod = { email: "prod@test", sector: "PRODUCCION" as const };
const calidad = { email: "cal@test", sector: "CALIDAD" as const };

describe("remitos packing + grouping", () => {
  it("cajas × unidades + warning", () => {
    expect(computeCajasProduct(20, 12)).toBe(240);
    expect(computeCajasProduct(null, 12)).toBeNull();
    const warn = packingTotalMismatchWarning(250, 19, 12);
    expect(warn.ok).toBe(false);
    expect(warn.calculated).toBe(228);
    expect(warn.difference).toBe(22);
    expect(packingTotalMismatchWarning(240, 20, 12).ok).toBe(true);
  });

  it("same client+date groups; different clients/dates never mix", () => {
    expect(remitoGroupKey("Acme SA", "2026-07-24")).toBe(
      remitoGroupKey("  ACME  sa ", "2026-07-24")
    );
    expect(normalizeClientId("A")).not.toBe(normalizeClientId("B"));
    expect(remitoGroupKey("A", "2026-01-01")).not.toBe(
      remitoGroupKey("A", "2026-01-02")
    );
  });

  it("different lotes = separate consolidated lines", () => {
    const out = consolidateLinesByProductLoteVto([
      {
        product: "Shampoo",
        lote: "L1",
        vto: "2027-01",
        totalUnits: 10,
        cajas1: 0,
        unidades1: 10,
        cajas2: 0,
        unidades2: 0,
      },
      {
        product: "Shampoo",
        lote: "L2",
        vto: "2027-01",
        totalUnits: 5,
        cajas1: 0,
        unidades1: 5,
        cajas2: 0,
        unidades2: 0,
      },
      {
        product: "Shampoo",
        lote: "L1",
        vto: "2027-01",
        totalUnits: 3,
        cajas1: 0,
        unidades1: 3,
        cajas2: 0,
        unidades2: 0,
      },
    ]);
    expect(out).toHaveLength(2);
    const l1 = out.find((x) => x.lote === "L1");
    expect(l1?.totalUnits).toBe(13);
  });
});

describe("RemitoService memoria", () => {
  beforeEach(() => {
    resetRemitoMemoryForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("only PRODUCCION access", async () => {
    expect(canAccessRemitos("PRODUCCION")).toBe(true);
    expect(canAccessRemitos("CALIDAD")).toBe(false);
    expect(canAccessRemitos("MATERIA_PRIMA")).toBe(false);
    await expect(getRemitoService().list(calidad)).rejects.toThrow(/PRODUCCIÓN|PRODUCCION/i);
  });

  it("same client+date groups multiple products; new work adds to draft", async () => {
    const svc = getRemitoService();
    const a = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-1",
      clientId: "Cliente Uno",
      deliveryDate: "2026-08-01",
      product: "Prod A",
      lote: "L-A",
      vto: "2027-01",
      totalUnits: 24,
      unitsPerCaja1: 12,
    });
    expect(a.created).toBe(true);
    expect(a.remito.status).toBe("BORRADOR");

    const b = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-2",
      clientId: "cliente uno",
      deliveryDate: "2026-08-01",
      product: "Prod B",
      lote: "L-B",
      totalUnits: 10,
    });
    expect(b.created).toBe(false);
    expect(b.remito.id).toBe(a.remito.id);
    expect(b.remito.lines).toHaveLength(2);
  });

  it("different clients never mix; different dates never mix", async () => {
    const svc = getRemitoService();
    const r1 = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-a",
      clientId: "Cliente A",
      deliveryDate: "2026-08-01",
      product: "X",
      totalUnits: 1,
    });
    const r2 = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-b",
      clientId: "Cliente B",
      deliveryDate: "2026-08-01",
      product: "Y",
      totalUnits: 1,
    });
    const r3 = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-c",
      clientId: "Cliente A",
      deliveryDate: "2026-08-02",
      product: "Z",
      totalUnits: 1,
    });
    expect(r1.remito.id).not.toBe(r2.remito.id);
    expect(r1.remito.id).not.toBe(r3.remito.id);
  });

  it("work item not duplicated", async () => {
    const svc = getRemitoService();
    await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-dup",
      clientId: "C",
      deliveryDate: "2026-08-01",
      product: "P",
      totalUnits: 5,
    });
    const again = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-dup",
      clientId: "C",
      deliveryDate: "2026-08-01",
      product: "P",
      totalUnits: 99,
    });
    expect(again.duplicateWorkItem).toBe(true);
    expect(again.remito.lines).toHaveLength(1);
    expect(again.remito.lines[0]?.totalUnits).toBe(5);
  });

  it("displayName saved on generate", async () => {
    const svc = getRemitoService();
    const draft = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-dn",
      clientId: "Cli DN",
      deliveryDate: "2026-09-10",
      product: "P",
      totalUnits: 4,
    });
    const generated = await svc.generate(prod, draft.remito.id, {
      displayName: "Remito Cliente DN Agosto",
    });
    expect(generated.status).toBe("GENERADO");
    expect(generated.displayName).toBe("Remito Cliente DN Agosto");
    expect(generated.remitoNumber).toBeTruthy();
    expect(generated.versions).toHaveLength(1);
    expect(generated.versions[0]?.downloadable).toBe(true);
  });

  it("edit generated creates new version; old remains downloadable", async () => {
    const svc = getRemitoService();
    const draft = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-edit-v",
      clientId: "CliEdit",
      deliveryDate: "2026-09-11",
      product: "P1",
      totalUnits: 8,
    });
    const generated = await svc.generate(prod, draft.remito.id, {
      displayName: "Remito Edit",
    });
    const remitoNumber = generated.remitoNumber;
    expect(generated.version).toBe(1);
    expect(generated.versions).toHaveLength(1);

    const v2 = await svc.editGenerated(prod, generated.id, {
      motivo: "Corrección de cantidades",
      lines: [
        {
          id: generated.lines[0]!.id,
          totalUnits: 10,
        },
      ],
    });
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("GENERADO");
    expect(v2.remitoNumber).toBe(remitoNumber);
    expect(v2.displayName).toBe("Remito Edit");
    expect(v2.versions).toHaveLength(2);
    expect(v2.versions.every((x) => x.downloadable)).toBe(true);
    expect(v2.versions[1]?.motivo).toBe("Corrección de cantidades");

    const dl1 = await svc.download(prod, v2.id, "pdf", 1);
    const dl2 = await svc.download(prod, v2.id, "pdf", 2);
    expect(dl1.bytes.length).toBeGreaterThan(10);
    expect(dl2.bytes.length).toBeGreaterThan(10);
  });

  it("generated immutable; new approval → new version offer", async () => {
    const svc = getRemitoService();
    const draft = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-gen-1",
      clientId: "Cli",
      deliveryDate: "2026-09-01",
      product: "P1",
      totalUnits: 12,
      unitsPerCaja1: 12,
    });
    const generated = await svc.generate(prod, draft.remito.id, {
      displayName: "Remito Cli",
    });
    expect(generated.status).toBe("GENERADO");

    const offer = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-gen-2",
      clientId: "Cli",
      deliveryDate: "2026-09-01",
      product: "P2",
      totalUnits: 6,
    });
    expect(offer.immutableOfferNewVersion).toBe(true);
    expect(offer.remito.status).toBe("GENERADO");
    expect(offer.remito.lines).toHaveLength(1);

    const next = await svc.newVersion(prod, generated.id, [
      {
        workItemId: "wi-gen-2",
        clientId: "Cli",
        deliveryDate: "2026-09-01",
        product: "P2",
        totalUnits: 6,
      },
    ]);
    expect(next.status).toBe("BORRADOR");
    expect(next.version).toBe(generated.version + 1);
    expect(next.lines).toHaveLength(1);
  });

  it("Drive fail simulation does not mark GENERADO", async () => {
    const svc = getRemitoService();
    const draft = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-drive-fail",
      clientId: "DriveFail",
      deliveryDate: "2026-10-03",
      product: "PD",
      totalUnits: 2,
    });

    vi.spyOn(featureSchema, "isFeatureMemoryAllowed").mockReturnValue(false);
    vi.spyOn(remitoSchema, "assertRemitoWritesEnabled").mockResolvedValue(undefined);
    vi.spyOn(remitoSchema, "isRemitoSchemaReady").mockResolvedValue(false);
    vi.spyOn(driveWrite, "getRemitosFolderId").mockReturnValue("folder-remitos-test");
    vi.spyOn(driveWrite, "uploadRemitoDriveFile").mockRejectedValue(
      new Error("Drive upload failed")
    );
    vi.spyOn(driveWrite, "trashRemitoDriveFile").mockResolvedValue(undefined);

    await expect(
      svc.generate(prod, draft.remito.id, { displayName: "No debe generar" })
    ).rejects.toThrow(/Drive upload failed/);

    const after = await svc.get(prod, draft.remito.id);
    expect(after?.status).toBe("BORRADOR");
    expect(after?.displayName).toBeNull();
    expect(after?.versions ?? []).toHaveLength(0);
  });

  it("statusForWorkItem reflects none/draft/generated", async () => {
    const svc = getRemitoService();
    expect(await svc.statusForWorkItem(prod, "missing")).toEqual({
      status: "none",
      remitoId: null,
    });
    const draft = await svc.upsertDraftFromApproval(prod, {
      workItemId: "wi-st",
      clientId: "St",
      deliveryDate: "2026-11-02",
      product: "PS",
      totalUnits: 1,
    });
    expect(await svc.statusForWorkItem(prod, "wi-st")).toEqual({
      status: "draft",
      remitoId: draft.remito.id,
    });
    await svc.generate(prod, draft.remito.id, { displayName: "ST" });
    expect(await svc.statusForWorkItem(prod, "wi-st")).toEqual({
      status: "generated",
      remitoId: draft.remito.id,
    });
  });

  it("systemHook permite upsert desde Calidad sin RBAC PRODUCCION", async () => {
    const svc = getRemitoService();
    const r = await svc.upsertDraftFromApproval(
      calidad,
      {
        workItemId: "wi-sys",
        clientId: "Sys",
        deliveryDate: "2026-11-01",
        product: "PS",
        totalUnits: 3,
      },
      { systemHook: true }
    );
    expect(r.created).toBe(true);
  });
});
