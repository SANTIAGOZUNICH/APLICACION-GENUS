import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateMpLabelDownloadSecretForTests,
  issueMpLabelDownloadTicket,
  MpLabelTicketConfigError,
  mpLabelTicketDownloadPath,
  MP_LABEL_TICKET_TTL_MS,
  resolveMpLabelTicketSecret,
  verifyMpLabelDownloadTicket,
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

  const prevSecret = process.env.MP_LABEL_DOWNLOAD_SECRET;

  beforeEach(() => {
    process.env.MP_LABEL_DOWNLOAD_SECRET = generateMpLabelDownloadSecretForTests();
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.MP_LABEL_DOWNLOAD_SECRET;
    else process.env.MP_LABEL_DOWNLOAD_SECRET = prevSecret;
  });

  it("exige MP_LABEL_DOWNLOAD_SECRET sin fallbacks", () => {
    delete process.env.MP_LABEL_DOWNLOAD_SECRET;
    expect(() => resolveMpLabelTicketSecret()).toThrow(MpLabelTicketConfigError);
    expect(() =>
      issueMpLabelDownloadTicket({
        email: "mp@laboratoriogenus.com.ar",
        sector: "MATERIA_PRIMA",
        source,
      })
    ).toThrow(MpLabelTicketConfigError);
  });

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

  it("TTL por defecto es 90 segundos", () => {
    expect(MP_LABEL_TICKET_TTL_MS).toBe(90_000);
  });
});
