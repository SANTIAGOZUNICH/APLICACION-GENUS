import { describe, expect, it } from "vitest";
import type { SectorId } from "@/types/operational/sector";
import {
  ORDER_DOCUMENT_DENIED_MESSAGE,
  ORDER_DOCUMENT_MISSING_ACTOR_MESSAGE,
  assertCanOrderDocumentAction,
  canOrderDocumentAction,
  gateOrderDocumentAction,
  type OrderDocAction,
} from "./order-documents-rbac";

const ALL_ACTIONS: OrderDocAction[] = ["view", "download", "upload", "replace"];
const OE_MUTATORS = ["PRODUCCION", "CALIDAD", "MATERIA_PRIMA"] as const satisfies readonly SectorId[];
const OA_READERS = ["ENVASADO_MASIVO", "ENVASADO_PREMIUM"] as const satisfies readonly SectorId[];
const OA_MUTATORS = ["PRODUCCION", "CALIDAD"] as const satisfies readonly SectorId[];

describe("order-documents-rbac", () => {
  it("permite OE lectura a Elaboración y mutación a Producción, Calidad y Materia Prima", () => {
    expect(canOrderDocumentAction("OE", "view", "ELABORACION")).toBe(true);
    expect(canOrderDocumentAction("OE", "download", "ELABORACION")).toBe(true);
    expect(canOrderDocumentAction("OE", "upload", "ELABORACION")).toBe(false);
    expect(canOrderDocumentAction("OE", "replace", "ELABORACION")).toBe(false);

    for (const sector of OE_MUTATORS) {
      for (const action of ALL_ACTIONS) {
        expect(canOrderDocumentAction("OE", action, sector)).toBe(true);
      }
    }
  });

  it("permite OA lectura a Envasado y mutación a Producción/Calidad", () => {
    for (const sector of OA_READERS) {
      expect(canOrderDocumentAction("OA", "view", sector)).toBe(true);
      expect(canOrderDocumentAction("OA", "download", sector)).toBe(true);
      expect(canOrderDocumentAction("OA", "upload", sector)).toBe(false);
      expect(canOrderDocumentAction("OA", "replace", sector)).toBe(false);
    }

    for (const sector of OA_MUTATORS) {
      for (const action of ALL_ACTIONS) {
        expect(canOrderDocumentAction("OA", action, sector)).toBe(true);
      }
    }
  });

  it("rechaza todo acceso OA para Materia Prima y otros sectores fuera de matriz", () => {
    for (const action of ALL_ACTIONS) {
      expect(canOrderDocumentAction("OA", action, "MATERIA_PRIMA")).toBe(false);
      expect(canOrderDocumentAction("OA", action, "ELABORACION")).toBe(false);
      expect(canOrderDocumentAction("OE", action, "DIRECCION")).toBe(false);
    }
  });

  it("gate y assert devuelven errores claros", () => {
    expect(gateOrderDocumentAction("OE", "upload", "PRODUCCION")).toEqual({ ok: true });

    const denied = gateOrderDocumentAction("OA", "view", "MATERIA_PRIMA");
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toBe(ORDER_DOCUMENT_DENIED_MESSAGE);
      expect(denied.code).toBe("ORDER_DOCUMENT_FORBIDDEN");
    }

    const missing = gateOrderDocumentAction("OE", "upload", null);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBe(ORDER_DOCUMENT_MISSING_ACTOR_MESSAGE);
      expect(missing.code).toBe("ORDER_DOCUMENT_MISSING_ACTOR");
    }

    expect(() => assertCanOrderDocumentAction("OA", "download", "CALIDAD")).not.toThrow();
    expect(() => assertCanOrderDocumentAction("OA", "download", "MATERIA_PRIMA")).toThrow(
      ORDER_DOCUMENT_DENIED_MESSAGE
    );
    expect(() => assertCanOrderDocumentAction("OE", "upload", undefined)).toThrow(
      ORDER_DOCUMENT_MISSING_ACTOR_MESSAGE
    );
  });
});
