import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  getLatestDocumentByRef,
  listDocumentsByRef,
  saveDocument,
  validateOrderFile,
} from "../adapters/order-documents-repository";
import { canOrderDocumentAction } from "./order-documents-rbac";

describe("order-documents mutations gated", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    vi.stubGlobal("localStorage", localStorageMock);
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  it("ELABORACION no puede subir OE — no muta", () => {
    const result = saveDocument({
      kind: "OE",
      ref: "OE-1",
      fileName: "a.pdf",
      fileType: "application/pdf",
      fileDataUrl: "data:application/pdf;base64,AAA",
      uploadedBy: "test",
      actorSectorId: "ELABORACION",
    });
    expect(result.ok).toBe(false);
    expect(getLatestDocumentByRef("OE-1")).toBeNull();
  });

  it("PRODUCCION puede subir OE y versionar", () => {
    const first = saveDocument({
      kind: "OE",
      ref: "OE-2",
      fileName: "v1.pdf",
      fileType: "application/pdf",
      fileDataUrl: "data:application/pdf;base64,AAA",
      uploadedBy: "Agustina",
      actorSectorId: "PRODUCCION",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = saveDocument({
      kind: "OE",
      ref: "OE-2",
      fileName: "v2.pdf",
      fileType: "application/pdf",
      fileDataUrl: "data:application/pdf;base64,BBB",
      uploadedBy: "Agustina",
      actorSectorId: "PRODUCCION",
    });
    expect(second.ok).toBe(true);
    const history = listDocumentsByRef("OE-2");
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(getLatestDocumentByRef("OE-2")?.fileName).toBe("v2.pdf");
  });

  it("MATERIA_PRIMA no tiene acceso a OA", () => {
    expect(canOrderDocumentAction("OA", "view", "MATERIA_PRIMA")).toBe(false);
    expect(canOrderDocumentAction("OA", "upload", "MATERIA_PRIMA")).toBe(false);
  });

  it("validateOrderFile rechaza extensión no permitida", () => {
    const bad = new File(["x"], "malware.exe", { type: "application/octet-stream" });
    const result = validateOrderFile(bad);
    expect(result.ok).toBe(false);
  });
});
