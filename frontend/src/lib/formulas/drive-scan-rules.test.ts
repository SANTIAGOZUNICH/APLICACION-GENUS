import { describe, expect, it } from "vitest";
import {
  classifyDriveScan,
  compareDriveWithBank,
  describeDriveAccessError,
  MIME_FOLDER,
  MIME_GSHEET,
  MIME_SHORTCUT,
  MIME_XLSX,
  type ScanItem,
} from "./drive-scan-rules";

const folder = (name: string, path: string[] = []): ScanItem => ({ id: `f-${[...path, name].join("/")}`, name, mimeType: MIME_FOLDER, modifiedTime: null, path });
const file = (name: string, path: string[], mimeType = MIME_XLSX, modifiedTime: string | null = "2026-01-01T00:00:00Z"): ScanItem => ({
  id: `x-${[...path, name].join("/")}`,
  name,
  mimeType,
  modifiedTime,
  path,
});

describe("classifyDriveScan — reproduce exactamente lo que lee el índice", () => {
  const tree: ScanItem[] = [
    folder("ACME"),
    folder("BETA"),
    file("CREMA HIDRATANTE.xlsx", ["ACME"]),
    file("SHAMPOO NEUTRO", ["ACME"], MIME_GSHEET),
    file("Gel.xls", ["BETA"], "application/vnd.ms-excel"),
    // anidado: ACME / 2024 / archivo
    folder("2024", ["ACME"]),
    file("CREMA CORPORAL.xlsx", ["ACME", "2024"]),
    // formatos no reconocidos
    file("SERUM.xlsm", ["BETA"], "application/vnd.ms-excel.sheet.macroEnabled.12"),
    file("TONICO.ods", ["BETA"], "application/vnd.oasis.opendocument.spreadsheet"),
    // suelto en la raíz
    file("FORMULA SUELTA.xlsx", []),
    // acceso directo a una planilla y a una carpeta
    { ...file("Acceso a JABON", ["BETA"], MIME_SHORTCUT), shortcutTargetMime: MIME_GSHEET },
    { ...file("Acceso a carpeta GAMMA", [], MIME_SHORTCUT), shortcutTargetMime: MIME_FOLDER },
    // dos versiones del mismo producto: gana la más reciente
    file("GEL.xlsx", ["BETA"], MIME_XLSX, "2026-05-01T00:00:00Z"),
    // otro archivo que no es planilla
    file("ficha tecnica.pdf", ["ACME"], "application/pdf"),
  ];
  const r = classifyDriveScan(tree);

  it("indexa solo hojas reconocidas directamente dentro de una carpeta de cliente", () => {
    expect(r.indexed.map((f) => `${f.client}/${f.name}`).sort()).toEqual(["ACME/CREMA HIDRATANTE.xlsx", "ACME/SHAMPOO NEUTRO", "BETA/GEL.xlsx"]);
    expect(r.clients).toEqual([
      { name: "ACME", indexedFiles: 2 },
      { name: "BETA", indexedFiles: 1 },
    ]);
  });

  it("explica cada archivo omitido con su motivo", () => {
    const by = Object.fromEntries(r.omitted.map((o) => [o.name, o.reason]));
    expect(by).toEqual({
      "CREMA CORPORAL.xlsx": "NESTED",
      "SERUM.xlsm": "UNSUPPORTED_TYPE",
      "TONICO.ods": "UNSUPPORTED_TYPE",
      "FORMULA SUELTA.xlsx": "ROOT_FILE",
      "Acceso a JABON": "SHORTCUT",
      "Acceso a carpeta GAMMA": "SHORTCUT",
      "Gel.xls": "SUPERSEDED",
    });
    expect(r.omitted.find((o) => o.name === "CREMA CORPORAL.xlsx")?.path).toBe("ACME / 2024");
    expect(r.omitted.find((o) => o.name === "Gel.xls")?.detail).toBe("Se usa «GEL.xlsx»");
    expect(r.otherFiles).toBe(1);
  });

  it("sin subcarpetas, las hojas de la raíz sí se leen (como el índice)", () => {
    const flat = classifyDriveScan([file("A.xlsx", []), file("B.xlsx", [])]);
    expect(flat.indexed.map((f) => f.client)).toEqual(["SIN_CLIENTE", "SIN_CLIENTE"]);
    expect(flat.omitted).toEqual([]);
  });
});

describe("compareDriveWithBank", () => {
  it("clasifica en ambos / solo Drive / solo banco / conflicto / ambigua / revisión", () => {
    const indexed = [
      { id: "1", client: "ACME", name: "a", productLabel: "CREMA", modifiedTime: null, mimeType: MIME_XLSX },
      { id: "2", client: "ACME", name: "b", productLabel: "NUEVA", modifiedTime: null, mimeType: MIME_XLSX },
      { id: "3", client: "ACME", name: "c", productLabel: "DOBLE", modifiedTime: null, mimeType: MIME_XLSX },
      { id: "4", client: "ACME", name: "d", productLabel: "AMBIGUA", modifiedTime: null, mimeType: MIME_XLSX },
      { id: "5", client: "ACME", name: "e", productLabel: "PEND", modifiedTime: null, mimeType: MIME_XLSX },
    ];
    const lookup = (_c: string, p: string) =>
      p === "CREMA"
        ? ({ kind: "found" } as const)
        : p === "DOBLE"
          ? ({ kind: "conflict" } as const)
          : p === "AMBIGUA"
            ? ({ kind: "not_found", reason: "ambiguous" } as const)
            : p === "PEND"
              ? ({ kind: "not_found", reason: "review_required" } as const)
              : ({ kind: "not_found", reason: "name_mismatch" } as const);
    const { counts, rows } = compareDriveWithBank({
      indexed,
      bankOptions: [
        { client: "ACME", productLabel: "Crema", aliases: [] },
        { client: "Acme", productLabel: "Solo Banco", aliases: [] },
        { client: "ACME", productLabel: "Otro nombre", aliases: ["nueva"] },
      ],
      lookup,
    });
    expect(counts).toEqual({ EN_AMBOS: 1, SOLO_DRIVE: 1, SOLO_BANCO: 1, CONFLICTO_BANCO: 1, AMBIGUA_BANCO: 1, REVISION_BANCO: 1 });
    expect(rows.find((r) => r.status === "SOLO_BANCO")?.product).toBe("Solo Banco");
  });
});

describe("describeDriveAccessError", () => {
  it("no inventa: 404 puede ser ID incorrecto o carpeta no compartida", () => {
    expect(describeDriveAccessError(403).status).toBe("SIN_PERMISO");
    expect(describeDriveAccessError(404).message).toMatch(/ID es incorrecto, o la carpeta no está compartida/);
    expect(describeDriveAccessError(500).status).toBe("ERROR");
  });
});
