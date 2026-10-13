import { beforeEach, describe, expect, it, vi } from "vitest";

/** Drive simulado: árbol de carpetas en memoria (solo lectura). Registra cada llamada para verificar que no escribe. */
type F = { id: string; name: string; mimeType: string; parents: string[]; modifiedTime?: string; driveId?: string; shortcutDetails?: { targetMimeType: string } };
const FOLDER = "application/vnd.google-apps.folder";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const files: F[] = [
  { id: "ROOT", name: "FORMULAS MAESTRAS", mimeType: FOLDER, parents: [], driveId: "SD1" },
  { id: "c1", name: "ACME", mimeType: FOLDER, parents: ["ROOT"] },
  { id: "x1", name: "CREMA.xlsx", mimeType: XLSX, parents: ["c1"], modifiedTime: "2026-01-01T00:00:00Z" },
  { id: "n1", name: "2024", mimeType: FOLDER, parents: ["c1"] },
  { id: "x2", name: "GEL.xlsx", mimeType: XLSX, parents: ["n1"] },
  { id: "x3", name: "SERUM.xlsm", mimeType: "application/vnd.ms-excel.sheet.macroEnabled.12", parents: ["c1"] },
  { id: "o1", name: "FORMULA PERDIDA.xlsx", mimeType: XLSX, parents: ["OTRA"] },
];
const calls: string[] = [];
let rootError: number | null = null;
const driveStub = {
  files: {
    get: async ({ fileId }: { fileId: string }) => {
      calls.push(`files.get:${fileId}`);
      if (rootError) throw Object.assign(new Error("x"), { code: rootError });
      const f = files.find((x) => x.id === fileId);
      if (!f) throw Object.assign(new Error("not found"), { code: 404 });
      return { data: f };
    },
    list: async ({ q }: { q: string }) => {
      calls.push("files.list");
      const m = /'([^']+)' in parents/.exec(q);
      if (m) return { data: { files: files.filter((f) => f.parents.includes(m[1]!)) } };
      return { data: { files: files.filter((f) => f.mimeType === XLSX) } };
    },
  },
  drives: {
    get: async () => ({ data: { id: "SD1", name: "Laboratorio" } }),
    list: async () => ({ data: { drives: [{ id: "SD1", name: "Laboratorio" }, { id: "SD2", name: "Administración" }] } }),
  },
};

vi.mock("server-only", () => ({}));
vi.mock("googleapis", () => ({ google: { drive: () => driveStub } }));
vi.mock("@/lib/adapters/google/google-auth", () => ({ createGoogleAuth: () => ({}), hasGoogleCredentials: () => true }));
vi.mock("@/lib/formulas/get-formula-bank", () => ({
  readyFormulaBank: async () => ({
    listActiveOptions: () => [
      { client: "ACME", productLabel: "CREMA", aliases: [] },
      { client: "ACME", productLabel: "SOLO EN BANCO", aliases: [] },
    ],
    resolveLookup: (_c: string, p: string) => (p.toUpperCase() === "CREMA" ? { kind: "found" } : { kind: "not_found", reason: "name_mismatch" }),
  }),
}));
vi.mock("@/lib/orders/actor", () => ({
  resolveOrdersActor: (request: Request) => ({ email: "t@x", sector: request.headers.get("x-sector") ?? "PRODUCCION", displayName: "T" }),
}));

process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "genus-os@proyecto.iam.gserviceaccount.com";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----SUPERSECRETO-----END PRIVATE KEY-----";
process.env.GOOGLE_DRIVE_FORMULAS_FOLDER_ID = "ROOT";

const { GET, POST } = await import("./route");
const req = (url: string, sector = "PRODUCCION", init: RequestInit = {}) => new Request(`http://x${url}`, { ...init, headers: { "x-sector": sector } });

beforeEach(() => {
  calls.length = 0;
  rootError = null;
});

describe("/api/v1/formulas/drive-connection", () => {
  it("solo sectores que administran fórmulas (Elaboración → 403)", async () => {
    expect((await GET(req("/api/v1/formulas/drive-connection?mode=check", "ELABORACION"))).status).toBe(403);
  });

  it("Verificar conexión: cuenta, carpeta, enlace y unidad compartida; nunca la clave privada", async () => {
    const res = await GET(req("/api/v1/formulas/drive-connection?mode=check"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("SUPERSECRETO");
    expect(text).not.toContain("PRIVATE KEY");
    const { check } = JSON.parse(text);
    expect(check).toMatchObject({
      status: "OK",
      serviceAccountEmail: "genus-os@proyecto.iam.gserviceaccount.com",
      folder: { id: "ROOT", name: "FORMULAS MAESTRAS", url: "https://drive.google.com/drive/folders/ROOT", driveLabel: "Unidad compartida «Laboratorio»" },
    });
  });

  it("diagnóstico completo: omitidos con motivo, fuera de la carpeta, comparación con el banco; solo lecturas", async () => {
    const res = await GET(req("/api/v1/formulas/drive-connection"));
    const { report } = await res.json();
    expect(report.scan.clients).toEqual([{ name: "ACME", indexedFiles: 1 }]);
    expect(report.scan.omittedCounts).toEqual({ NESTED: 1, UNSUPPORTED_TYPE: 1 });
    expect(report.scan.omitted.find((o: { name: string }) => o.name === "GEL.xlsx")).toMatchObject({ path: "ACME / 2024", reason: "NESTED" });
    expect(report.outside.sheetsOutsideRoot.map((f: { name: string }) => f.name)).toEqual(["FORMULA PERDIDA.xlsx"]);
    expect(report.outside.sharedDrives).toEqual([
      { name: "Laboratorio", containsRoot: true },
      { name: "Administración", containsRoot: false },
    ]);
    expect(report.bank.counts).toMatchObject({ EN_AMBOS: 1, SOLO_BANCO: 1 });
    expect(JSON.stringify(report)).not.toContain('"x2"'); // sin IDs crudos: enlaces
    expect(calls.every((c) => c.startsWith("files.get") || c === "files.list")).toBe(true);
  });

  it("sin permiso / no encontrada: lo dice sin inventar la causa", async () => {
    rootError = 404;
    const { check } = await (await GET(req("/api/v1/formulas/drive-connection?mode=check"))).json();
    expect(check.status).toBe("NO_ENCONTRADA");
    expect(check.message).toMatch(/o el ID es incorrecto, o la carpeta no está compartida/);
    rootError = 403;
    const { report } = await (await GET(req("/api/v1/formulas/drive-connection"))).json();
    expect(report.status).toBe("SIN_PERMISO");
    expect(report.scan).toBeNull();
  });

  it("Actualizar índice: acción explícita (POST) y solo autorizada", async () => {
    expect((await POST(req("/api/v1/formulas/drive-connection", "CALIDAD", { method: "POST", body: JSON.stringify({ action: "otra" }) }))).status).toBe(400);
    expect((await POST(req("/api/v1/formulas/drive-connection", "ENVASADO_MASIVO", { method: "POST", body: JSON.stringify({ action: "refresh" }) }))).status).toBe(403);
  });
});
