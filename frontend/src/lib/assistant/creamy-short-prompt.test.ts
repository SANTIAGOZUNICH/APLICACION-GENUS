import { describe, expect, it } from "vitest";
import { buildGenusCreamySystemPrompt } from "@/lib/assistant/creamy-system-prompt";
import { countWords, sanitizeCreamyReply } from "@/lib/creamy-memory/sanitize";
import { DEFAULT_GEMINI_MODEL } from "@/lib/assistant/creamy-provider";

describe("Creamy short prompt + sanitize", () => {
  it("keeps gemini-2.0-flash as default model", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-2.0-flash");
  });

  it("system prompt enforces short replies and hides provider details", () => {
    const prompt = buildGenusCreamySystemPrompt({
      actor: {
        email: "mp@laboratoriogenus.com.ar",
        displayName: "Materia Prima",
        sector: "MATERIA_PRIMA",
        sectorLabel: "Materias Primas",
      },
      uiContext: {
        route: "mp-ingresos",
        tab: "mp_ingresos",
        moduleName: "Ingresos MP",
        availableNav: ["mi_trabajo", "mp_ingresos", "stock"],
      },
    });
    expect(prompt).toMatch(/≤100 palabras|100 palabras/i);
    expect(prompt).toContain("mp@laboratoriogenus.com.ar");
    expect(prompt).toContain("MATERIA_PRIMA");
    expect(prompt).toMatch(/No expliques infraestructura|proveedores|fallback/i);
    expect(prompt).not.toMatch(/gemini-2\.5|openai/i);
  });

  it("sanitize removes fallback note and keeps short body", () => {
    const long = Array.from({ length: 120 }, (_, i) => `palabra${i}`).join(" ");
    const cleaned = sanitizeCreamyReply(
      `${long}\n_(Respuesta generada con proveedor alternativo.)_\nNAV_ACTIONS: mp_ingresos|IR A INGRESOS MP`
    );
    expect(cleaned).not.toMatch(/proveedor alternativo/i);
    expect(countWords(cleaned.replace(/\nNAV_ACTIONS:.*/i, ""))).toBeLessThanOrEqual(105);
    expect(cleaned).toContain("NAV_ACTIONS: mp_ingresos|IR A INGRESOS MP");
  });
});
