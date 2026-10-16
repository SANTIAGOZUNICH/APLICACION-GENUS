import { describe, expect, it } from "vitest";
import {
  AUTO_SCORE,
  clientKey,
  computeFlags,
  decideDriveFormula,
  extractProductCode,
  markDuplicates,
  matchClientFolders,
  productKeyOf,
  productLabelOf,
  rankText,
  type DriveIndexFile,
} from "./drive-match-rules";

let seq = 0;
function file(client: string, fileName: string, extra: Partial<DriveIndexFile> = {}, otherClients: string[] = []): DriveIndexFile {
  const subPath = extra.subPath ?? "";
  const productLabel = productLabelOf(fileName, client);
  const { flags, otherClient } = computeFlags({ fileName, subPath, clientFolderName: client }, otherClients);
  return {
    fileId: `f${++seq}`,
    clientFolderId: `folder-${clientKey(client)}`,
    clientFolderName: client,
    subPath,
    fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    modifiedTime: "2026-10-01T10:00:00Z",
    productLabel,
    productKey: productKeyOf(productLabel, client, otherClient ? [otherClient] : []),
    productCode: extractProductCode(fileName),
    flags,
    otherClient,
    ...extra,
  };
}
const index = (files: DriveIndexFile[]) => markDuplicates(files);
const CLIENTS = ["ALL BEAUTY", "FIRMEA", "LUCENT", "TSU COSMETICS S.A."];

describe("normalización de clientes y productos", () => {
  it("cliente: tildes, mayúsculas, guiones y sufijos societarios", () => {
    expect(clientKey("TSU Cosméticos S.R.L.")).toBe(clientKey("tsu cosmeticos"));
    expect(clientKey("All-Beauty")).toBe("all beauty");
    expect(matchClientFolders("ALLBEAUTY", [{ id: "1", name: "ALL BEAUTY" }]).exact).toHaveLength(1);
  });

  it("producto: quita cliente, «Copia de», versiones, fechas y «(1)»", () => {
    expect(productKeyOf("Copia de CREMA DE ORDEÑE - ALL BEAUTY (1).xlsx", "ALL BEAUTY")).toBe("crema de ordene");
    expect(productKeyOf("SERUM ÁCIDO HIALURÓNICO v2 2025.xlsx", "ALL BEAUTY")).toBe("serum acido hialuronico");
    expect(productKeyOf("OE Gel Frío - FINAL.xls")).toBe("gel frio");
  });

  it("código de producto: «AB-123» sí; versiones y medidas no", () => {
    expect(extractProductCode("CREMA AB-123 ALL BEAUTY.xlsx")).toBe("ab123");
    expect(extractProductCode("SERUM v2.xlsx")).toBeNull();
    expect(extractProductCode("SHAMPOO 500 ML.xlsx")).toBeNull();
  });
});

describe("decisión: cliente primero, después producto", () => {
  it("cliente y producto exactos → un archivo", () => {
    const files = index([file("ALL BEAUTY", "EMULSION CORPORAL- ALL BEAUTY.xlsx"), file("ALL BEAUTY", "SERUM ACIDO HIALURONICO - ALL BEAUTY.xlsx"), file("FIRMEA", "EMULSION CORPORAL.xlsx")]);
    const d = decideDriveFormula("All Beauty", "Emulsión corporal", files);
    expect(d.kind).toBe("one");
    if (d.kind === "one") expect(d.file.fileName).toBe("EMULSION CORPORAL- ALL BEAUTY.xlsx");
  });

  it("nombres ligeramente distintos (tildes, guiones, orden de palabras) → se encuentra", () => {
    const files = index([file("LUCENT", "SERUM-ADN 1%.xlsx"), file("LUCENT", "GEL FRIO PIERNAS.xls")]);
    expect(decideDriveFormula("Lucent", "Serum ADN 1 %", files).kind).toBe("one");
    expect(decideDriveFormula("LUCENT", "Piernas gel frío", files).kind).toBe("one");
  });

  it("con un error de tipeo o una palabra de menos → solo se OFRECE como opción (no se usa sola)", () => {
    const files = index([file("LUCENT", "SERUM ACIDO HIALURONICO.xlsx")]);
    const d = decideDriveFormula("LUCENT", "SERUM ACIDO HIALURONCO", files);
    expect(d.kind).toBe("none");
    expect(d.candidates[0]!.fileName).toBe("SERUM ACIDO HIALURONICO.xlsx");
    expect(d.candidates[0]!.score).toBeLessThan(AUTO_SCORE);
  });

  it("copias y versiones del mismo producto (ALL BEAUTY) → ambiguo, con opciones marcadas", () => {
    const files = index([
      file("ALL BEAUTY", "CREMA DE ORDEÑE - ALL BEAUTY.xlsx"),
      file("ALL BEAUTY", "Copia de CREMA DE ORDEÑE - ALL BEAUTY.xlsx"),
      file("ALL BEAUTY", "CREMA DE ORDEÑE v2.xlsx"),
    ]);
    const d = decideDriveFormula("ALL BEAUTY", "CREMA DE ORDEÑE", files);
    expect(d.kind).toBe("ambiguous");
    expect(d.candidates).toHaveLength(3);
    expect(d.candidates.every((c) => c.flags.includes("duplicado"))).toBe(true);
    expect(d.candidates.find((c) => c.fileName.startsWith("Copia"))!.flags).toContain("copia");
    expect(d.candidates.find((c) => c.fileName.includes("v2"))!.flags).toContain("version");
  });

  it("archivo que parece de otro cliente → no se usa solo, se pide confirmar", () => {
    const files = index([file("FIRMEA", "EMULSION CORPORAL- ALL BEAUTY.xlsx", {}, CLIENTS)]);
    expect(files[0]!.flags).toContain("otro_cliente");
    expect(files[0]!.otherClient).toBe("ALL BEAUTY");
    const d = decideDriveFormula("FIRMEA", "EMULSION CORPORAL", files);
    expect(d.kind).toBe("ambiguous");
    if (d.kind === "ambiguous") expect(d.message).toMatch(/otro cliente/);
  });

  it("código exacto manda sobre el nombre; códigos distintos nunca se usan solos", () => {
    const files = index([file("ALL BEAUTY", "CREMA AB-123.xlsx"), file("ALL BEAUTY", "CREMA AB-124.xlsx")]);
    const one = decideDriveFormula("ALL BEAUTY", "CREMA AB 123", files);
    expect(one.kind).toBe("one");
    if (one.kind === "one") expect(one.file.fileName).toBe("CREMA AB-123.xlsx");
    expect(decideDriveFormula("ALL BEAUTY", "CREMA AB-999", files).kind).toBe("none");
  });

  it("nunca busca en otro cliente: sin carpeta del cliente → sin archivo, solo sugerencias de carpetas", () => {
    const files = index([file("ALL BEAUTY", "EMULSION CORPORAL.xlsx"), file("FIRMEA", "EMULSION CORPORAL.xlsx")]);
    const d = decideDriveFormula("AB", "EMULSION CORPORAL", files);
    expect(d.kind).toBe("none");
    if (d.kind === "none") expect(d.clientSuggestions).toEqual(["ALL BEAUTY"]);
    const z = decideDriveFormula("ZETA", "EMULSION CORPORAL", files);
    expect(z.kind).toBe("none");
    expect(z.candidates).toHaveLength(0);
  });

  it("archivo en subcarpeta de versiones anteriores + el vigente → ambiguo (Producción elige)", () => {
    const files = index([file("LUCENT", "GEL FRIO.xlsx"), file("LUCENT", "GEL FRIO.xlsx", { subPath: "VERSIONES ANTERIORES" })]);
    const d = decideDriveFormula("LUCENT", "GEL FRIO", files);
    expect(d.kind).toBe("ambiguous");
    expect(d.candidates.find((c) => c.subPath)!.flags).toEqual(expect.arrayContaining(["subcarpeta", "carpeta_antigua"]));
  });
});

describe("carpeta del cliente con nombre distinto al del trabajo (caso TRC)", () => {
  const trc = (folder: string, extra: DriveIndexFile[] = []) => index([file(folder, "SHAMPOO PLUS - TRC.xlsx"), file("OTRO CLIENTE", "SHAMPOO PLUS.xlsx"), ...extra]);

  it.each(["TRC", "TRC HAIR CARE", "LABORATORIO TRC", "T.R.C.", "TRC S.R.L.", "trc cosmetica"])("cliente «TRC» → carpeta «%s»: encuentra SHAMPOO PLUS (sin tomar el de otro cliente)", (folder) => {
    const d = decideDriveFormula("TRC", "SHAMPOO PLUS", trc(folder));
    expect(d.kind).toBe("one");
    if (d.kind === "one") {
      expect(d.file.clientFolderName).toBe(folder);
      expect(d.file.fileName).toBe("SHAMPOO PLUS - TRC.xlsx");
    }
  });

  it("dos carpetas que contienen al cliente como palabra → ninguna es segura: solo opciones", () => {
    const files = index([file("TRC HAIR CARE", "SHAMPOO PLUS.xlsx"), file("TRC PROFESIONAL", "SHAMPOO PLUS.xlsx")]);
    const d = decideDriveFormula("TRC", "SHAMPOO PLUS", files);
    expect(d.kind).toBe("none");
    if (d.kind === "none") expect(d.clientSuggestions.sort()).toEqual(["TRC HAIR CARE", "TRC PROFESIONAL"]);
    expect(d.candidates).toHaveLength(2);
  });

  it("parte de otra palabra no alcanza («TRC» ≠ «ELECTRCO»): solo sugerencia, nunca se usa", () => {
    const d = decideDriveFormula("TRC", "SHAMPOO PLUS", index([file("ELECTRCO", "SHAMPOO PLUS.xlsx")]));
    expect(d.kind).toBe("none");
  });

  it("carpeta aprendida de un vínculo de Producción: se usa aunque el nombre no se parezca", () => {
    const files = index([file("TRICOLOGIA CAPILAR", "SHAMPOO PLUS.xlsx"), file("TRICOLOGIA CAPILAR", "ACONDICIONADOR PLUS.xlsx")]);
    expect(decideDriveFormula("TRC", "ACONDICIONADOR PLUS", files).kind).toBe("none");
    const learned = decideDriveFormula("TRC", "ACONDICIONADOR PLUS", files, { learnedFolderIds: [files[0]!.clientFolderId] });
    expect(learned.kind).toBe("one");
  });

  it("la búsqueda manual y la automática usan la misma regla de texto", () => {
    expect(rankText("trc", "trc hair care")).toBe("exact_prefix");
    expect(rankText("trc", "laboratorio trc")).toBe("word_prefix");
    expect(matchClientFolders("TRC", [{ id: "1", name: "TRC HAIR CARE" }])).toMatchObject({ how: "contiene" });
    expect(matchClientFolders("TRC", [{ id: "1", name: "T.R.C." }])).toMatchObject({ how: "nombre" });
  });

  it("copias del mismo producto en la carpeta encontrada → sigue siendo ambiguo", () => {
    const d = decideDriveFormula("TRC", "SHAMPOO PLUS", trc("TRC HAIR CARE", [file("TRC HAIR CARE", "Copia de SHAMPOO PLUS - TRC.xlsx")]));
    expect(d.kind).toBe("ambiguous");
  });
});
