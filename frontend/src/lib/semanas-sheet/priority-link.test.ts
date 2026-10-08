import { describe, expect, it } from "vitest";
import { linkWorkItemPriority, type PriorityLinkRow } from "./priority-link";

const row = (over: Partial<PriorityLinkRow> = {}): PriorityLinkRow => ({
  tab: "ELABORACION", taskKey: "k", taskDate: "2026-05-07", taskDateTo: "2026-05-07", clientNorm: "bl cosmetic", productsNorm: ["serum jojoba"], sectionNorm: "cristian",
  priority: "URGENTE", version: 2, updatedByName: "Producción", updatedAt: "2026-05-06T10:00:00Z", ...over,
});
const wi = (over: Record<string, unknown> = {}) => ({ sector: "ELABORACION", plannedDate: "2026-05-07", client: "BL COSMETIC", product: "Serum Jojoba 50KG", ...over });

describe("prioridad compartida: enlace inequívoco Semanas ↔ tarea del sector", () => {
  it("Elaboración ve la prioridad que Producción asignó (mismo día, cliente y producto; tolera tildes/cantidad)", () => {
    expect(linkWorkItemPriority(wi(), [row()])).toMatchObject({ priority: "URGENTE", updatedByName: "Producción" });
    expect(linkWorkItemPriority(wi({ product: "SÉRUM JOJOBA" }), [row()])?.priority).toBe("URGENTE");
  });
  it("si Producción la vuelve a NORMAL, Elaboración la ve NORMAL", () => {
    expect(linkWorkItemPriority(wi(), [row({ priority: "NORMAL", version: 3 })])?.priority).toBe("NORMAL");
  });
  it("otro día, otro cliente u otro producto → no se asigna", () => {
    expect(linkWorkItemPriority(wi({ plannedDate: "2026-05-08" }), [row()])).toBeNull();
    expect(linkWorkItemPriority(wi({ client: "OTRO" }), [row()])).toBeNull();
    expect(linkWorkItemPriority(wi({ product: "CREMA DE ORDEÑE" }), [row()])).toBeNull();
  });
  it("tareas de varios días cubren todo su rango", () => {
    const r = row({ taskDate: "2026-05-05", taskDateTo: "2026-05-06" });
    expect(linkWorkItemPriority(wi({ plannedDate: "2026-05-06" }), [r])?.priority).toBe("URGENTE");
    expect(linkWorkItemPriority(wi({ plannedDate: "2026-05-07" }), [r])).toBeNull();
  });
  it("Envasado Masivo y Premium solo ven su sección de ACONDICIONAMIENTO; Codificado hereda la del envasado de origen", () => {
    const masivo = row({ tab: "ACONDICIONAMIENTO", sectionNorm: "envasado consumo masivo", productsNorm: ["sanitizante floral"], clientNorm: "tyl" });
    const premium = row({ tab: "ACONDICIONAMIENTO", sectionNorm: "envasado productos premiun", productsNorm: ["sanitizante floral"], clientNorm: "tyl", priority: "IMPORTANTE" });
    const base = { plannedDate: "2026-05-07", client: "TYL", product: "SANITIZANTE FLORAL CRUSH" };
    expect(linkWorkItemPriority({ ...base, sector: "ENVASADO_MASIVO" }, [masivo, premium])?.priority).toBe("URGENTE");
    expect(linkWorkItemPriority({ ...base, sector: "ENVASADO_PREMIUM" }, [masivo, premium])?.priority).toBe("IMPORTANTE");
    expect(linkWorkItemPriority({ ...base, sector: "CODIFICADO", codificadoOriginSector: "ENVASADO_PREMIUM" }, [masivo, premium])?.priority).toBe("IMPORTANTE");
    expect(linkWorkItemPriority({ ...base, sector: "CODIFICADO", codificadoOriginSector: null }, [masivo, premium])).toBeNull();
  });
  it("sectores sin tarea en Semanas (Depósito, Calidad…) no reciben prioridad inventada", () => {
    expect(linkWorkItemPriority(wi({ sector: "DEPOSITO" }), [row()])).toBeNull();
    expect(linkWorkItemPriority(wi({ sector: "CALIDAD" }), [row()])).toBeNull();
  });
  it("si dos tareas candidatas tienen prioridades distintas es AMBIGUO y no se adivina; si coinciden, se usa esa", () => {
    expect(linkWorkItemPriority(wi(), [row({ taskKey: "a" }), row({ taskKey: "b", priority: "NORMAL" })])).toBeNull();
    expect(linkWorkItemPriority(wi(), [row({ taskKey: "a" }), row({ taskKey: "b" })])?.priority).toBe("URGENTE");
  });
  it("sin fecha o sin producto no hay enlace", () => {
    expect(linkWorkItemPriority(wi({ plannedDate: null }), [row()])).toBeNull();
    expect(linkWorkItemPriority(wi({ product: null }), [row()])).toBeNull();
  });
});
