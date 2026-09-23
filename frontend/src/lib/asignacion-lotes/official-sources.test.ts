import { beforeEach, describe, expect, it } from "vitest";
import {
  getAsignacionLoteSourcesService,
  resetAsignacionLoteSourcesMemoryForTests,
} from "./asignacion-lote-sources-service";
import { OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS, ensureOfficialSourcesAndRetireRedundant } from "./official-sources";

const admin = { email: "produccion@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };
const system = { email: "asignacion-lotes-sync@sistema", displayName: "Sincronización Google Sheets" };

describe("ensureOfficialSourcesAndRetireRedundant — cambio definitivo: dos spreadsheets oficiales, sin configuración manual", () => {
  beforeEach(() => {
    resetAsignacionLoteSourcesMemoryForTests();
  });

  it("declara exactamente las dos fuentes oficiales pedidas (2025 y 2026), con los spreadsheetId reales", () => {
    expect(OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS).toHaveLength(2);
    const byYear = Object.fromEntries(OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS.map((s) => [s.year, s.spreadsheetId]));
    expect(byYear["2025"]).toBe("1HqvRt1_1XDT1nOhnxFLr7oEhOc5uZhvYirX2GdjiFOU");
    expect(byYear["2026"]).toBe("1MUPI0vgnXZOD2Iy5lyaGlGls-Dgwz353pbL57YlJI6o");
  });

  it("primera corrida: crea las dos fuentes oficiales (spreadsheet completo, sheetTab null) sin que nadie las conecte desde la UI", async () => {
    await ensureOfficialSourcesAndRetireRedundant(system);
    const all = await getAsignacionLoteSourcesService().listAllForSync();
    expect(all).toHaveLength(2);
    for (const official of OFFICIAL_ASIGNACION_LOTES_SPREADSHEETS) {
      const match = all.find((s) => s.spreadsheetId === official.spreadsheetId);
      expect(match).toBeTruthy();
      expect(match!.sheetTab).toBeNull();
      expect(match!.enabled).toBe(true);
      expect(match!.name).toBe(official.name);
    }
  });

  it("es idempotente: llamarla muchas veces (como hace cada corrida del cron) nunca duplica las fuentes oficiales", async () => {
    await ensureOfficialSourcesAndRetireRedundant(system);
    await ensureOfficialSourcesAndRetireRedundant(system);
    await ensureOfficialSourcesAndRetireRedundant(system);
    const all = await getAsignacionLoteSourcesService().listAllForSync();
    expect(all).toHaveLength(2);
  });

  it("sección 15: retira (deshabilita, NUNCA borra) fuentes viejas de pruebas anteriores que apuntan al mismo spreadsheet con una hoja individual", async () => {
    const svc = getAsignacionLoteSourcesService();
    const legacySeptiembre = await svc.create(admin, {
      name: "Asignación Lotes 2026 (SEPTIEMBRE, prueba anterior)",
      period: "2026",
      spreadsheetUrlOrId: `https://docs.google.com/spreadsheets/d/1MUPI0vgnXZOD2Iy5lyaGlGls-Dgwz353pbL57YlJI6o`,
      sheetTab: "SEPTIEMBRE",
    });
    const legacyOctubre = await svc.create(admin, {
      name: "Asignación Lotes 2026 (OCTUBRE, otra prueba)",
      period: "2026",
      spreadsheetUrlOrId: `https://docs.google.com/spreadsheets/d/1MUPI0vgnXZOD2Iy5lyaGlGls-Dgwz353pbL57YlJI6o`,
      sheetTab: "OCTUBRE",
    });

    await ensureOfficialSourcesAndRetireRedundant(system);

    const refreshedSeptiembre = await svc.getForSync(legacySeptiembre.id);
    const refreshedOctubre = await svc.getForSync(legacyOctubre.id);
    expect(refreshedSeptiembre?.enabled).toBe(false);
    expect(refreshedOctubre?.enabled).toBe(false);
    expect(refreshedSeptiembre?.lastError).toContain("fuente oficial");

    // Nunca se borran — siguen existiendo, solo deshabilitadas.
    const all = await svc.listAllForSync();
    expect(all.some((s) => s.id === legacySeptiembre.id)).toBe(true);
    expect(all.some((s) => s.id === legacyOctubre.id)).toBe(true);

    // La fuente oficial (spreadsheet completo) sí quedó creada y habilitada.
    const official = all.find((s) => s.spreadsheetId === legacySeptiembre.spreadsheetId && !s.sheetTab);
    expect(official?.enabled).toBe(true);
  });

  it("nunca toca fuentes de OTROS spreadsheets (no oficiales) — no las deshabilita ni las duplica", async () => {
    const svc = getAsignacionLoteSourcesService();
    const other = await svc.create(admin, {
      name: "Otra planilla sin relación",
      period: "2024",
      spreadsheetUrlOrId: "https://docs.google.com/spreadsheets/d/completamenteDistintoZZZ",
      sheetTab: "HOJA1",
    });
    await ensureOfficialSourcesAndRetireRedundant(system);
    const refreshed = await svc.getForSync(other.id);
    expect(refreshed?.enabled).toBe(true);
    const all = await svc.listAllForSync();
    // 2 oficiales + la fuente ajena, nunca más.
    expect(all).toHaveLength(3);
  });

  it("si ya existe una fuente oficial habilitada, no la vuelve a deshabilitar a sí misma ni la duplica", async () => {
    await ensureOfficialSourcesAndRetireRedundant(system);
    const before = await getAsignacionLoteSourcesService().listAllForSync();
    await ensureOfficialSourcesAndRetireRedundant(system);
    const after = await getAsignacionLoteSourcesService().listAllForSync();
    expect(after).toHaveLength(before.length);
    expect(after.every((s) => s.enabled)).toBe(true);
  });
});
