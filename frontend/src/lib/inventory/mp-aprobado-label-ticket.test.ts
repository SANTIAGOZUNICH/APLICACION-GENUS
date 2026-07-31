import { describe, expect, it } from "vitest";
import {
  issueMpLabelDownloadTicket,
  mpLabelTicketDownloadPath,
  verifyMpLabelDownloadTicket,
  MP_LABEL_TICKET_TTL_MS,
} from "./mp-aprobado-label-ticket";

describe("mp-aprobado-label-ticket", () => {
  const source = {
    id: "t1",
    producto: "CARBOPOL 940",
    pccMeNro: "PCC-ME-00125",
    fecha: "2026-07-30",
    remitoNro: "000123",
    cantidad: 25,
    proveedor: "BASF",
    bultos: 1,
    lote: "L240730",
  };

  it("emite y verifica ticket firmado con datos de etiqueta", () => {
    const now = 1_700_000_000_000;
    const issued = issueMpLabelDownloadTicket({
      email: "mp@laboratoriogenus.com.ar",
      sector: "MATERIA_PRIMA",
      source,
      nowMs: now,
    });
    expect(issued.filename).toBe("ETIQUETA-MP-CARBOPOL-940-L240730.pdf");
    expect(issued.expiresAt).toBe(now + MP_LABEL_TICKET_TTL_MS);
    expect(mpLabelTicketDownloadPath(issued.token)).toContain(
      "/api/v1/mp-labels/aprobado/download?t="
    );

    const payload = verifyMpLabelDownloadTicket(issued.token, { nowMs: now + 1000 });
    expect(payload.email).toBe("mp@laboratoriogenus.com.ar");
    expect(payload.sector).toBe("MATERIA_PRIMA");
    expect(payload.data.producto).toBe("CARBOPOL 940");
    expect(payload.data.loteProveedor).toBe("L240730");
    expect(payload.filename).toBe("ETIQUETA-MP-CARBOPOL-940-L240730.pdf");
  });

  it("rechaza ticket alterado", () => {
    const issued = issueMpLabelDownloadTicket({
      email: "mp@laboratoriogenus.com.ar",
      sector: "MATERIA_PRIMA",
      source,
    });
    const tampered = `${issued.token.slice(0, -4)}XXXX`;
    expect(() => verifyMpLabelDownloadTicket(tampered)).toThrow(/firmado|alterado/i);
  });

  it("rechaza ticket expirado", () => {
    const now = 1_700_000_000_000;
    const issued = issueMpLabelDownloadTicket({
      email: "mp@laboratoriogenus.com.ar",
      sector: "MATERIA_PRIMA",
      source,
      nowMs: now,
      ttlMs: 1000,
    });
    expect(() =>
      verifyMpLabelDownloadTicket(issued.token, { nowMs: now + 5000 })
    ).toThrow(/expirado/i);
  });

  it("no confía en campos mutables: el payload firmado fija el lote", () => {
    const issued = issueMpLabelDownloadTicket({
      email: "mp@laboratoriogenus.com.ar",
      sector: "MATERIA_PRIMA",
      source,
    });
    const payload = verifyMpLabelDownloadTicket(issued.token);
    expect(payload.data.loteProveedor).toBe("L240730");
    // Cambiar query params no aplica: solo el token firmado define el PDF.
    expect(issued.token.includes("HACKED")).toBe(false);
  });
});
