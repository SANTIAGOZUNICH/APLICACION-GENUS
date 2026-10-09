/** Usuarios de prueba del E2E local. Solo existen en bases marcadas por setup-e2e-db.mjs (dominio .test, no reales). */
export const E2E_PASSWORD = process.env.GENUS_E2E_PASSWORD || "E2e-Genus-Local-1!";

export const E2E_USERS = {
  produccion: { email: "e2e-produccion@genus.test", sector: "PRODUCCION", displayName: "E2E Producción", role: "ROL-SU", roleLabel: "Supervisora", sectorLabel: "Producción" },
  envasado: { email: "e2e-envasado@genus.test", sector: "ENVASADO_MASIVO", displayName: "E2E Envasado", role: "ROL-OP", roleLabel: "Operario", sectorLabel: "Envasado Masivo" },
  elaboracion: { email: "e2e-elaboracion@genus.test", sector: "ELABORACION", displayName: "E2E Elaboración", role: "ROL-OP", roleLabel: "Operario", sectorLabel: "Elaboración" },
  calidad: { email: "e2e-calidad@genus.test", sector: "CALIDAD", displayName: "E2E Calidad", role: "ROL-CA", roleLabel: "Calidad", sectorLabel: "Calidad" },
  codificado: { email: "e2e-codificado@genus.test", sector: "CODIFICADO", displayName: "E2E Codificado", role: "ROL-OP", roleLabel: "Operario", sectorLabel: "Codificado" },
};
