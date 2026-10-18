/**
 * Lectura REAL con Gemini de un remito de PRUEBA (ficticio, sin datos sensibles): src/lib/inventory/__fixtures__/remito-prueba.png.
 * Se SALTA salvo que exista GEMINI_API_KEY en el entorno; hace una llamada real al proveedor y NO toca base de datos ni stock.
 *
 *   GEMINI_API_KEY=… npx vitest run src/integration/ingreso-remito-gemini-real.integration.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractRemito, probeExtraction } from "@/lib/inventory/receipt-extraction";

const KEY = process.env.GEMINI_API_KEY?.trim();
const env = { INGRESO_REMITO_EXTRACTION: "gemini", GEMINI_API_KEY: KEY, INGRESO_REMITO_GEMINI_MODEL: process.env.INGRESO_REMITO_GEMINI_MODEL } as Partial<NodeJS.ProcessEnv>;

describe.skipIf(!KEY)("Gemini REAL: lectura de un remito de prueba (ficticio)", () => {
  it("la clave responde, se descubre un modelo vigente y ese modelo analiza una IMAGEN", async () => {
    const p = await probeExtraction({ env, image: true });
    console.log("[gemini real] configuración:", JSON.stringify({ configuredModel: p.configuredModel, effectiveModel: p.effectiveModel, modelosDeLaClave: p.listing.candidates, intentos: p.attempts, texto: p.text.message, imagen: p.image }));
    expect(p.text.ok, p.text.message).toBe(true);
    expect(p.effectiveModel).toBeTruthy();
    expect(p.image?.ok, p.image?.message).toBe(true);
  }, 120_000);

  it("foto → Gemini → encabezado y renglones", async () => {
    const bytes = new Uint8Array(readFileSync(path.join(process.cwd(), "src/lib/inventory/__fixtures__/remito-prueba.png")));
    const out = await extractRemito([{ bytes, contentType: "image/png" }], { env });
    expect(out.ok, out.ok ? "" : out.message).toBe(true);
    if (!out.ok) return;
    const d = out.data;
    console.log("[gemini real] lectura:", JSON.stringify({ supplier: d.supplier, remito: d.remitoNumber, fecha: d.remitoDate, lineas: d.lines.map((l) => [l.supplierCode, l.description, l.quantity, l.unit, l.packages, l.lote, l.vencimiento, l.review]) }));
    expect(d.supplier.toUpperCase()).toContain("DISTRIBUIDORA PRUEBA");
    expect(d.remitoNumber.replace(/\D/g, "")).toContain("45678");
    expect(d.remitoDate).toBe("2026-10-14");
    expect(d.lines).toHaveLength(3);
    const gli = d.lines.find((l) => /glicerina/i.test(l.description))!;
    expect(gli).toMatchObject({ quantity: "250", lote: "LT-2026-0457", vencimiento: "2029-06-30", packages: "10" });
    expect(gli.unit.toLowerCase()).toBe("kg");
    const tex = d.lines.find((l) => /texapon/i.test(l.description))!;
    expect(tex).toMatchObject({ quantity: "50", lote: "", vencimiento: "" }); // sin lote/vencimiento impresos: no se inventan
    expect(tex.review).toEqual(expect.arrayContaining(["lote", "vencimiento"]));
  }, 120_000);
});
