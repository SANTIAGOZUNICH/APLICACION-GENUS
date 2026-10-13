/**
 * Carpeta de fórmulas ADICIONAL: se suma a la principal sin reemplazarla. Drive simulado en memoria (solo lectura).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NEW_ID = "1qX-YjiHKbnymGgbqTcUtsQqWUI4L2Z2P";
type Tree = Record<string, { folders: Array<{ folderId: string; name: string }>; files: Array<{ fileId: string; name: string; modifiedTime?: string }> }>;
let tree: Tree = {};
let inaccessible = new Set<string>();
const content: Record<string, string> = {};
const downloads: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/adapters/google/google-auth", () => ({ hasGoogleCredentials: () => true, createGoogleAuth: () => ({}) }));
vi.mock("@/lib/adapters/drive/google-drive-gateway", () => ({
  GoogleDriveGateway: class {
    canAccessFolder = async (id: string) => !inaccessible.has(id) && Boolean(tree[id]);
    listSubfolders = async (id: string) => tree[id]?.folders ?? [];
    listSpreadsheetsInFolder = async (id: string) => (tree[id]?.files ?? []).map((f) => ({ ...f, mimeType: XLSX }));
    getFileMetadata = async () => null;
  },
  OFFICE_SHEET_MIMES: [XLSX],
  FOLDER_MIME: "application/vnd.google-apps.folder",
}));
vi.mock("googleapis", () => ({
  google: {
    drive: () => ({
      files: {
        get: async ({ fileId }: { fileId: string }) => {
          downloads.push(fileId);
          return { data: new TextEncoder().encode(content[fileId] ?? "").buffer };
        },
      },
    }),
  },
}));
vi.mock("./get-formula-bank", () => ({
  readyFormulaBank: async () => ({ resolveLookup: () => ({ kind: "not_found", reason: "name_mismatch", message: "No está." }) }),
}));

const idx = await import("./drive-formulas-index");
const { resolveExtraFormulasFolderIds } = await import("./drive-formulas-diagnose");
const { resolveFormulaForWork } = await import("./resolve-for-work");

beforeEach(() => {
  process.env.GOOGLE_DRIVE_FORMULAS_FOLDER_ID = "PRINCIPAL";
  delete process.env.GOOGLE_DRIVE_FORMULAS_EXTRA_FOLDER_IDS;
  inaccessible = new Set();
  downloads.length = 0;
  tree = {
    PRINCIPAL: { folders: [{ folderId: "p-acme", name: "ACME" }], files: [] },
    "p-acme": { folders: [], files: [{ fileId: "f1", name: "CREMA.xlsx" }] },
    [NEW_ID]: { folders: [{ folderId: "n-acme", name: "Acme" }, { folderId: "n-beta", name: "BETA" }], files: [] },
    // f1 también visible desde la carpeta nueva (mismo archivo): no se duplica.
    "n-acme": { folders: [], files: [{ fileId: "f2", name: "CREMA.xlsx" }, { fileId: "f3", name: "GEL.xlsx" }, { fileId: "f1", name: "CREMA.xlsx" }] },
    "n-beta": { folders: [], files: [{ fileId: "f4", name: "JABON.xlsx" }] },
  };
  idx.resetDriveFormulasIndexForTests();
});

describe("carpetas de fórmulas adicionales", () => {
  it("la carpeta nueva se suma a la principal; si es la misma que la principal, no se repite", () => {
    expect(resolveExtraFormulasFolderIds()).toEqual([NEW_ID]);
    process.env.GOOGLE_DRIVE_FORMULAS_EXTRA_FOLDER_IDS = `OTRA, ${NEW_ID}, PRINCIPAL`;
    expect(resolveExtraFormulasFolderIds()).toEqual([NEW_ID, "OTRA"]);
    process.env.GOOGLE_DRIVE_FORMULAS_FOLDER_ID = NEW_ID;
    delete process.env.GOOGLE_DRIVE_FORMULAS_EXTRA_FOLDER_IDS;
    expect(resolveExtraFormulasFolderIds()).toEqual([]);
  });

  it("el índice lee las dos carpetas, sin repetir el mismo archivo y uniendo clientes", async () => {
    await idx.syncDriveFormulasIndex(true);
    expect(idx.getDriveFormulasIndexSources()).toEqual([
      { folderId: "PRINCIPAL", primary: true, accessible: true },
      { folderId: NEW_ID, primary: false, accessible: true },
    ]);
    expect(await idx.listDriveClientsCached()).toEqual(["Acme", "BETA"]);
    const acme = await idx.listDriveProductsForClientCached("ACME");
    expect(acme.map((e) => `${e.fileId}:${e.primarySource ? "P" : "N"}`).sort()).toEqual(["f1:P", "f2:N", "f3:N"]);
    expect((await idx.listDriveProductsForClientCached("beta")).map((e) => e.fileId)).toEqual(["f4"]);
  });

  it("si la carpeta nueva no es accesible, la principal sigue funcionando igual", async () => {
    inaccessible.add(NEW_ID);
    const r = await idx.syncDriveFormulasIndex(true);
    expect(r.ok).toBe(true);
    expect(idx.getDriveFormulasIndexSources()?.[1]).toEqual({ folderId: NEW_ID, primary: false, accessible: false });
    expect((await idx.listDriveProductsForClientCached("ACME")).map((e) => e.fileId)).toEqual(["f1"]);
  });

  it("mismo cliente+producto en las dos carpetas con versiones DISTINTAS: conflicto, no se elige ninguna", async () => {
    content.f1 = "version A";
    content.f2 = "version B";
    const r = await resolveFormulaForWork({ client: "ACME", product: "CREMA" });
    expect(r).toMatchObject({ ok: false, status: "conflict" });
    expect(!r.ok && r.message).toMatch(/más de una carpeta de fórmulas de Drive con versiones distintas/);
  });

  it("mismo contenido en las dos carpetas: no es conflicto, se usa el de la carpeta principal", async () => {
    content.f1 = "igual";
    content.f2 = "igual";
    const r = await resolveFormulaForWork({ client: "ACME", product: "CREMA" });
    // El contenido simulado no es una planilla real: falla al leerla, pero ya NO por conflicto, y se leyó f1 (principal).
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).not.toBe("conflict");
    expect(downloads.filter((d) => d === "f1").length).toBe(2); // checksum + lectura
    expect(downloads.filter((d) => d === "f2").length).toBe(1); // solo checksum
  });

  it("producto solo en la carpeta nueva: se encuentra (búsqueda en ambas carpetas)", async () => {
    content.f3 = "x";
    const r = await resolveFormulaForWork({ client: "ACME", product: "GEL" });
    expect(downloads).toContain("f3");
    expect(!r.ok && r.status).not.toBe("not_found");
  });
});
